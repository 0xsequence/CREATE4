// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {CREATE3} from "./CREATE3.sol";

/**
 *   @title CREATE4
 *   @author Agustin Aguilar <aa@horizon.io>
 *   @notice Deploys per-chain contract variants from a Merkle-committed “deployment plan” while preserving a single address across chains.
 *   @dev The contract trusts the plan: it only checks Merkle proofs and gap ranges, and does not enforce correctness or non-malleability of the tree.
 */
contract CREATE4 {
    error GapCannotBeFallback();
    error InvalidProvidedGap();
    error MismatchedProof();
    error ChainIdOverflow();

    // Leaf prefix encoding / decoding -----------------------------------------

    /**
     *   @notice Packs chain ids and the fallback flag into a leaf prefix.
     *   @dev Layout: [isFallback (8 bits) | nextChainid (64 bits) | chainid (64 bits)].
     */
    function packLeafPrefix(uint64 chainid, uint64 nextChainid, uint8 isFallback) internal pure returns (bytes32) {
        return bytes32(uint256(isFallback) << 248 | uint256(nextChainid) << 64 | uint256(chainid));
    }

    /**
     *   @notice Decodes a packed leaf prefix into its components.
     *   @param leaf The packed leaf prefix.
     *   @return chainid Current chain id segment.
     *   @return nextChainid Next chain id segment.
     *   @return isFallback Non-zero when this leaf represents the fallback.
     */
    function decodeLeafPrefix(bytes32 leaf)
        internal
        pure
        returns (uint64 chainid, uint64 nextChainid, uint8 isFallback)
    {
        uint256 x = uint256(leaf);
        chainid = uint64(x & 0xffffffffffffffff);
        nextChainid = uint64((x >> 64) & 0xffffffffffffffff);
        isFallback = uint8(x >> 248);
    }

    // Main deployment path ----------------------------------------------------

    /**
     *   @notice Deploys a chain-specific version according to its Merkle proof.
     *   @param proof Merkle proof from the leaf to the plan root.
     *   @param initCode Init code of the contract to deploy for this chain.
     *   @param nextChainid The next chain id in the leaf interval.
     *   @param salt User-supplied salt mixed into the plan root.
     *   @return Address of the deployed contract.
     */
    function deploy(bytes32[] calldata proof, bytes calldata initCode, uint64 nextChainid, bytes32 salt)
        external
        payable
        returns (address)
    {
        bytes32 initCodeHash = keccak256(initCode);

        if (block.chainid > type(uint64).max) {
            revert ChainIdOverflow();
        }

        bytes32 leafPrefix = packLeafPrefix(uint64(block.chainid), nextChainid, 0);
        bytes32 node = scratchPackedKeccak256(leafPrefix, initCodeHash);

        unchecked {
            for (uint256 i = 0; i < proof.length; i++) {
                node = commutativeKeccak256(node, proof[i]);
            }
        }

        // Bind plan root to user salt and deploy via CREATE3
        bytes32 root = scratchPackedKeccak256(node, salt);
        return CREATE3.create3(root, initCode, msg.value);
    }

    /**
     *   @notice Deploys the fallback version when the current chain is in a gap.
     *   @dev Verifies both the gap leaf and the fallback leaf resolve to the same root.
     *   @param gapLeafPrefix Prefix of the gap leaf (non-fallback leaf).
     *   @param gapLeafHash Init code hash stored in the gap leaf.
     *   @param gapProof Merkle proof from the gap leaf to the root.
     *   @param proof Merkle proof from the fallback leaf to the root.
     *   @param initCode Fallback init code to deploy.
     *   @param salt User-supplied salt mixed into the plan root.
     *   @return Address of the deployed fallback contract.
     */
    function deployFallback(
        bytes32 gapLeafPrefix,
        bytes32 gapLeafHash,
        bytes32[] calldata gapProof,
        bytes32[] calldata proof,
        bytes calldata initCode,
        bytes32 salt
    ) external payable returns (address) {
        (uint64 gapChainId, uint64 gapNextChainid, uint8 gapIsFallback) = decodeLeafPrefix(gapLeafPrefix);

        // Gap leaf itself cannot be the fallback leaf
        if (gapIsFallback != 0) {
            revert GapCannotBeFallback();
        }

        // Ensure current chain id lies inside the gap interval (with wrap support)
        if (gapChainId < gapNextChainid) {
            // Non-wrap: (gapChainId, gapNextChainid)
            if (block.chainid <= gapChainId || block.chainid >= gapNextChainid) {
                revert InvalidProvidedGap();
            }
        } else if (gapChainId > gapNextChainid) {
            // Wrap: (gapChainId, 2^256-1] ∪ [0, gapNextChainid)
            // So we revert only if we're in the *complement* [gapNextChainid, gapChainId]
            if (block.chainid >= gapNextChainid && block.chainid <= gapChainId) {
                revert InvalidProvidedGap();
            }
        } else {
            // Single-entry plan: every other chain maps to fallback
            if (block.chainid == gapChainId) {
                revert InvalidProvidedGap();
            }
        }

        // Verify gap leaf hash
        bytes32 gapLeaf = scratchPackedKeccak256(gapLeafPrefix, gapLeafHash);
        unchecked {
            for (uint256 i = 0; i < gapProof.length; i++) {
                gapLeaf = commutativeKeccak256(gapLeaf, gapProof[i]);
            }
        }

        // Recompute fallback leaf and its path
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 fallbackPrefix = packLeafPrefix(0, 0, 1);
        bytes32 fallbackNode = scratchPackedKeccak256(fallbackPrefix, initCodeHash);
        unchecked {
            for (uint256 i = 0; i < proof.length; i++) {
                fallbackNode = commutativeKeccak256(fallbackNode, proof[i]);
            }
        }

        // Both nodes must resolve to the same root
        if (gapLeaf != fallbackNode) {
            revert MismatchedProof();
        }

        // Deploy fallback using the shared root and user salt
        bytes32 root = scratchPackedKeccak256(fallbackNode, salt);
        return CREATE3.create3(root, initCode, msg.value);
    }

    // Hash helpers ------------------------------------------------------------

    /**
     *   @notice Computes keccak256(a, b) in a commutative way.
     *   @dev Sorts inputs so keccak(a, b) == keccak(b, a).
     */
    function commutativeKeccak256(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        if (a < b) {
            return scratchPackedKeccak256(a, b);
        } else {
            return scratchPackedKeccak256(b, a);
        }
    }

    /**
     *   @notice Computes keccak256 over the concatenation of two 32-byte values.
     *   @dev Uses scratch memory at 0x00–0x3f.
     */
    function scratchPackedKeccak256(bytes32 a, bytes32 b) internal pure returns (bytes32 c) {
        assembly ("memory-safe") {
            mstore(0x00, a)
            mstore(0x20, b)
            c := keccak256(0x00, 0x40)
        }
    }
}
