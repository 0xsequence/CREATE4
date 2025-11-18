const { keccak256 } = require('./deploymentPlan');
const { hexToBuffer } = require('./utils');

const KECCAK256_PROXY_CHILD_BYTECODE = Buffer.from(
  '21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f',
  'hex'
);

function bufferToHex(buffer) {
  return '0x' + buffer.toString('hex');
}

function normalizeAddress(value) {
  if (typeof value !== 'string') {
    throw new Error('address must be a hex string');
  }
  const hex = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(hex)) {
    throw new Error(`invalid address: ${value}`);
  }
  return hex;
}

function computeCreate3Address(factoryAddress, deploymentSalt) {
  const factoryBytes = hexToBuffer(normalizeAddress(factoryAddress), {
    expectedLength: 20,
    fieldName: 'factory address',
  });
  const saltBuffer = Buffer.isBuffer(deploymentSalt)
    ? deploymentSalt
    : hexToBuffer(deploymentSalt, { expectedLength: 32, fieldName: 'deployment salt' });
  if (saltBuffer.length !== 32) {
    throw new Error('deployment salt must be 32 bytes');
  }
  const saltBytes = Buffer.alloc(32, 0);
  saltBuffer.copy(saltBytes, 0, 0, 32);
  const data = Buffer.concat([
    Buffer.from('ff', 'hex'),
    factoryBytes,
    saltBytes,
    KECCAK256_PROXY_CHILD_BYTECODE,
  ]);
  const proxyHash = keccak256(data);
  const proxyBytes = proxyHash.slice(12);
  const encoded = Buffer.concat([Buffer.from('d694', 'hex'), proxyBytes, Buffer.from('01', 'hex')]);
  const finalHash = keccak256(encoded);
  return bufferToHex(finalHash.slice(12));
}

module.exports = {
  computeCreate3Address,
  normalizeAddress,
  bufferToHex,
};
