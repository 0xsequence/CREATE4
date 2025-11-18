const { keccak256: keccak256Hasher } = require('js-sha3');
const { bytecodeToBuffer, normalizeChainId, sortChainsById, UINT64_MAX } = require('./utils');

function keccak256(buffer) {
  const hash = keccak256Hasher.create();
  hash.update(buffer);
  return Buffer.from(hash.arrayBuffer());
}

function toHex(buffer) {
  return '0x' + buffer.toString('hex');
}

function encodeUint256(value) {
  if (value < 0n) {
    throw new Error('negative values are not allowed');
  }
  let hex = value.toString(16);
  if (hex.length > 64) {
    throw new Error('value exceeds 32 bytes');
  }
  hex = hex.padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

function packLeafPrefix(chainId, nextChainId, isFallback) {
  // Layout:
  // - bits [0..63]: chainId of the leaf
  // - bits [64..127]: nextChainId pointing to the successor leaf
  // - bit 248: 1 if the leaf represents the fallback entry, 0 otherwise
  // Remaining bits are zeroed to keep the prefix deterministic.
  const cid = normalizeChainId(chainId, 'chain id');
  const ncid = normalizeChainId(nextChainId, 'next chain id');
  if (isFallback !== 0 && isFallback !== 1) {
    throw new Error('isFallback must be 0 or 1');
  }
  const bitValue = (BigInt(isFallback) << 248n) | (ncid << 64n) | cid;
  return encodeUint256(bitValue);
}

function scratchPackedKeccak(a, b) {
  return keccak256(Buffer.concat([a, b]));
}

function commutativeKeccak(a, b) {
  // Hash leaves in sorted order so the Merkle tree remains commutative with respect
  // to sibling ordering. This guarantees that a client can recompute the same root
  // regardless of how proof elements are presented.
  return Buffer.compare(a, b) < 0 ? scratchPackedKeccak(a, b) : scratchPackedKeccak(b, a);
}

function buildMerkleTree(leafHashes) {
  // Leaves are hashed via commutativeKeccak so that upstream tooling can reorder sibling
  // proofs without changing the resulting root. This keeps proof verification simple even
  // when intermediate layers are reconstructed in a different order.
  if (leafHashes.length === 0) {
    throw new Error('cannot build a tree with zero leaves');
  }

  const layers = [leafHashes.slice()];

  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = i + 1 < prev.length ? prev[i + 1] : left;
      next.push(commutativeKeccak(left, right));
    }
    layers.push(next);
  }

  function getProof(index) {
    if (index < 0 || index >= leafHashes.length) {
      throw new Error('leaf index out of bounds');
    }
    const proof = [];
    let idx = index;
    for (let level = 0; level < layers.length - 1; level++) {
      const layer = layers[level];
      const isRightNode = idx % 2 === 1;
      const pairIndex = isRightNode ? idx - 1 : idx + 1;
      const sibling = pairIndex < layer.length ? layer[pairIndex] : layer[idx];
      proof.push(sibling);
      idx = Math.floor(idx / 2);
    }
    return proof;
  }

  return {
    root: layers[layers.length - 1][0],
    getProof,
  };
}

function buildDeploymentPlan(chainEntries, fallbackInitCode) {
  if (!Array.isArray(chainEntries) || chainEntries.length === 0) {
    throw new Error('at least one chain entry is required');
  }
  if (!fallbackInitCode) {
    throw new Error('fallback init code is required');
  }

  const normalized = chainEntries.map((entry, index) => {
    if (entry.chainId === undefined) {
      throw new Error(`chain entry at index ${index} is missing a chainId`);
    }
    if (!entry.initCode) {
      throw new Error(`chain entry at index ${index} is missing init code`);
    }
    const chainId = normalizeChainId(entry.chainId, `chain id for entry ${index}`);
    return {
      chainId,
      initCode: bytecodeToBuffer(entry.initCode, `init code for chain ${chainId}`),
      label: entry.label || `chain-${chainId}`,
    };
  });

  const sorted = sortChainsById(normalized);

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].chainId === sorted[i - 1].chainId) {
      throw new Error('duplicate chain ids are not allowed');
    }
  }

  const leaves = sorted.map((entry, idx) => {
    const nextEntry = sorted[(idx + 1) % sorted.length];
    const initCodeHash = keccak256(entry.initCode);
    const prefix = packLeafPrefix(entry.chainId, nextEntry.chainId, 0);
    const leafHash = scratchPackedKeccak(prefix, initCodeHash);
    return {
      type: 'chain',
      chainId: entry.chainId,
      nextChainId: nextEntry.chainId,
      initCode: entry.initCode,
      initCodeHash,
      prefix,
      leafHash,
      label: entry.label,
    };
  });

  const fallbackBuffer = bytecodeToBuffer(fallbackInitCode, 'fallback init code');
  const fallbackLeaf = {
    type: 'fallback',
    chainId: 0n,
    nextChainId: 0n,
    initCode: fallbackBuffer,
    initCodeHash: keccak256(fallbackBuffer),
    prefix: packLeafPrefix(0n, 0n, 1),
  };
  fallbackLeaf.leafHash = scratchPackedKeccak(fallbackLeaf.prefix, fallbackLeaf.initCodeHash);

  const merkleLeaves = [...leaves, fallbackLeaf];
  const tree = buildMerkleTree(merkleLeaves.map((leaf) => leaf.leafHash));

  const serializedLeaves = merkleLeaves.map((leaf, idx) => ({
    ...leaf,
    proof: tree.getProof(idx),
  }));

  return {
    root: toHex(tree.root),
    leaves: serializedLeaves.filter((leaf) => leaf.type === 'chain').map(serializeLeaf),
    fallback: serializeLeaf(serializedLeaves.find((leaf) => leaf.type === 'fallback')),
  };
}

function serializeLeaf(leaf) {
  return {
    chainId: leaf.chainId.toString(),
    nextChainId: leaf.nextChainId.toString(),
    label: leaf.label,
    initCode: toHex(leaf.initCode),
    initCodeHash: toHex(leaf.initCodeHash),
    prefix: toHex(leaf.prefix),
    leafHash: toHex(leaf.leafHash),
    proof: leaf.proof.map(toHex),
  };
}

function isChainIdInGap(chainId, nextChainId, targetChainId) {
  const cid = normalizeChainId(chainId, 'chain id');
  const next = normalizeChainId(nextChainId, 'next chain id');
  const target = normalizeChainId(targetChainId, 'target chain id');
  if (cid === next) {
    // Single-entry plan: all other chain ids map to fallback.
    return target !== cid;
  }
  if (cid < next) {
    return target > cid && target < next;
  }
  return target > cid || target < next;
}

function describeGapRange(chainId, nextChainId) {
  const cid = normalizeChainId(chainId, 'chain id');
  const next = normalizeChainId(nextChainId, 'next chain id');
  if (cid === next) {
    return `gap: target != ${cid.toString()} (single entry plan)`;
  }
  if (cid < next) {
    const start = cid + 1n;
    const end = next - 1n;
    if (start > end) {
      return 'gap: none (adjacent chain ids)';
    }
    if (start === end) {
      return `gap: target == ${start.toString()}`;
    }
    return `gap: ${start.toString()} <= target <= ${end.toString()}`;
  }

  const segments = [];
  if (cid < UINT64_MAX) {
    const start = cid + 1n;
    const highRange =
      start === UINT64_MAX ? `target == ${start.toString()}` : `${start.toString()} <= target <= ${UINT64_MAX.toString()}`;
    segments.push(highRange);
  }
  if (next > 0n) {
    const end = next - 1n;
    segments.push(end === 0n ? 'target == 0' : `0 <= target <= ${end.toString()}`);
  }

  if (segments.length === 0) {
    return 'gap: none (wrap leaf without slack)';
  }
  if (segments.length === 1) {
    return `wrap gap: ${segments[0]}`;
  }
  return `wrap gap: ${segments[0]} or ${segments[1]}`;
}

module.exports = {
  buildDeploymentPlan,
  packLeafPrefix,
  scratchPackedKeccak,
  keccak256,
  isChainIdInGap,
  describeGapRange,
};
