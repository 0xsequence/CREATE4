const SALT_REGEX = /^0x[0-9a-fA-F]{64}$/;
const ZERO_SALT = '0x' + '00'.repeat(32);

function normalizeSaltHex(value) {
  if (typeof value !== 'string') {
    throw new Error('salt must be provided as a string');
  }
  const normalized = value.trim();
  if (!SALT_REGEX.test(normalized)) {
    throw new Error('salt must be a 32-byte hex value prefixed with 0x');
  }
  return normalized.toLowerCase();
}

function getSaltHex(spec, overrideSalt) {
  if (overrideSalt !== undefined && overrideSalt !== null) {
    return normalizeSaltHex(String(overrideSalt));
  }
  if (spec && typeof spec.salt === 'string' && spec.salt.trim().length > 0) {
    return normalizeSaltHex(spec.salt);
  }
  // Default to an all-zero salt so CREATE3 deployments remain deterministic when
  // the spec omits a value. The behavior is shared across all CLI commands.
  return ZERO_SALT;
}

module.exports = {
  normalizeSaltHex,
  getSaltHex,
  ZERO_SALT,
};
