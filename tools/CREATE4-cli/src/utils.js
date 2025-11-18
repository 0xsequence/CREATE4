const UINT64_MAX = (1n << 64n) - 1n;
const HEX_BODY_REGEX = /^[0-9a-fA-F]+$/;

function normalizeChainId(value, fieldName = 'chain id') {
  if (value === undefined || value === null) {
    throw new Error(`${fieldName} is required`);
  }

  let parsed;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${fieldName} must be an integer`);
    }
    parsed = BigInt(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error(`${fieldName} cannot be empty`);
    }
    try {
      parsed = BigInt(trimmed);
    } catch (err) {
      throw new Error(`invalid ${fieldName}: ${value}`);
    }
  } else {
    throw new Error(`${fieldName} must be a number, bigint, or string`);
  }

  if (parsed < 0n || parsed > UINT64_MAX) {
    throw new Error(`${fieldName} must fit within uint64`);
  }
  return parsed;
}

function normalizeHexString(
  value,
  { fieldName = 'hex value', allowEmpty = false, stripWhitespace = false, stripQuotes = false } = {}
) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be provided as a string`);
  }

  let normalized = value.trim();
  if (
    stripQuotes &&
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (stripWhitespace) {
    normalized = normalized.replace(/\s+/g, '');
  }
  if (normalized.startsWith('0x') || normalized.startsWith('0X')) {
    normalized = normalized.slice(2);
  }
  if (normalized.length === 0) {
    if (allowEmpty) {
      return '0x';
    }
    throw new Error(`${fieldName} cannot be empty`);
  }
  if (!HEX_BODY_REGEX.test(normalized)) {
    throw new Error(`${fieldName} must be a hex string`);
  }
  if (normalized.length % 2 !== 0) {
    throw new Error(`${fieldName} hex length must be even`);
  }
  return '0x' + normalized.toLowerCase();
}

function convertNormalizedHexToBuffer(normalized, fieldName, expectedLength) {
  const body = normalized.startsWith('0x') ? normalized.slice(2) : normalized;
  const buf = Buffer.from(body, 'hex');
  if (expectedLength !== undefined && buf.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} bytes for ${fieldName} but received ${buf.length}`);
  }
  return buf;
}

function hexToBuffer(value, options = {}) {
  const { expectedLength, fieldName = 'hex value', stripWhitespace = false, stripQuotes = false } = options;
  const normalized = normalizeHexString(value, { fieldName, stripWhitespace, stripQuotes });
  return convertNormalizedHexToBuffer(normalized, fieldName, expectedLength);
}

function normalizeBytecode(value, fieldName = 'bytecode') {
  return normalizeHexString(value, { fieldName, stripWhitespace: true, stripQuotes: true });
}

function bytecodeToBuffer(value, fieldName = 'bytecode') {
  const normalized = normalizeBytecode(value, fieldName);
  return convertNormalizedHexToBuffer(normalized, fieldName);
}

function chainIdToJsonValue(value) {
  return normalizeChainId(value).toString();
}

function looksLikeHex(value) {
  if (typeof value !== 'string') {
    return false;
  }
  let normalized = value.trim();
  if (normalized.startsWith('0x') || normalized.startsWith('0X')) {
    normalized = normalized.slice(2);
  }
  if (normalized.length === 0) {
    return false;
  }
  return HEX_BODY_REGEX.test(normalized);
}

function sortChainsById(entries, selector = (entry) => entry.chainId) {
  const copy = [...(entries || [])];
  copy.sort((a, b) => {
    const aId = normalizeChainId(selector(a));
    const bId = normalizeChainId(selector(b));
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    return 0;
  });
  return copy;
}

module.exports = {
  UINT64_MAX,
  normalizeChainId,
  chainIdToJsonValue,
  normalizeBytecode,
  bytecodeToBuffer,
  hexToBuffer,
  looksLikeHex,
  sortChainsById,
};
