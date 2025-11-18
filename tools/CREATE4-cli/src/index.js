const deploymentPlan = require('./deploymentPlan');
const { parseChainIdInput } = require('./wipBuilder');
const { getSaltHex, normalizeSaltHex, ZERO_SALT } = require('./salt');
const { hexToBuffer } = require('./utils');
const { computeCreate3Address: computeCreate3, normalizeAddress, bufferToHex } = require('./create3');

const { packLeafPrefix, scratchPackedKeccak } = deploymentPlan;

function assertSpecObject(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('Plan spec must be a JSON object');
  }
  return spec;
}

function copyPlanMetadata(source, target) {
  if (source.name) {
    target.name = source.name;
  }
  if (source.version) {
    target.version = source.version;
  }
  if (source.description) {
    target.description = source.description;
  }
}

/**
 * Build a deterministic CREATE4 deployment plan from the provided entries.
 *
 * @param {Array<{chainId: number|string|bigint, initCode: string, label?: string}>} chainEntries
 * @param {string} fallbackInitCode Hex encoded fallback init code.
 * @returns {{root: string, leaves: Array<{chainId: string, nextChainId: string, label?: string, initCode: string, initCodeHash: string, prefix: string, leafHash: string, proof: Array<string>}>, fallback: {chainId: string, nextChainId: string, initCode: string, initCodeHash: string, prefix: string, leafHash: string, proof: Array<string>}}}
 */
function buildDeploymentPlan(chainEntries, fallbackInitCode) {
  return deploymentPlan.buildDeploymentPlan(chainEntries, fallbackInitCode);
}

/**
 * Build a deployment plan directly from a JSON spec and include metadata.
 *
 * @param {{chains: Array, fallbackInitCode: string, salt?: string, name?: string, description?: string, version?: string}} spec
 * @returns {{root: string, leaves: Array<{chainId: string, nextChainId: string, label?: string, initCode: string, initCodeHash: string, prefix: string, leafHash: string, proof: Array<string>}>, fallback: {chainId: string, nextChainId: string, initCode: string, initCodeHash: string, prefix: string, leafHash: string, proof: Array<string>}, salt: string, name?: string, description?: string, version?: string}}
 */
function buildPlanFromSpec(spec) {
  const normalized = assertSpecObject(spec);
  const basePlan = deploymentPlan.buildDeploymentPlan(normalized.chains, normalized.fallbackInitCode);
  const result = {
    root: basePlan.root,
    leaves: basePlan.leaves,
    fallback: basePlan.fallback,
    salt: getSaltHex(normalized),
  };
  copyPlanMetadata(normalized, result);
  return result;
}

/**
 * Hash the plan root with the provided salt to obtain the CREATE3 deployment salt.
 *
 * @param {string} planRootHex Hex encoded plan root.
 * @param {string} saltHex Hex encoded 32-byte salt value.
 * @returns {string} Hex encoded deployment salt.
 */
function deriveDeploymentSalt(planRootHex, saltHex) {
  const planRoot = hexToBuffer(planRootHex, { expectedLength: 32, fieldName: 'plan root' });
  const salt = hexToBuffer(saltHex, { expectedLength: 32, fieldName: 'salt' });
  return bufferToHex(scratchPackedKeccak(planRoot, salt));
}

/**
 * Compute full CREATE3 deployment details (address + salts) for the given spec.
 *
 * @param {object} spec JSON spec passed to {@link buildPlanFromSpec}.
 * @param {string} factoryAddress Address of the CREATE3 factory contract.
 * @param {{ saltOverride?: string }} [options] Optional override for the salt.
 * @returns {{factory: string, planRoot: string, salt: string, deploymentSalt: string, address: string}}
 */
function computePlanDeployment(spec, factoryAddress, { saltOverride } = {}) {
  const plan = buildPlanFromSpec(spec);
  const salt = saltOverride !== undefined ? normalizeSaltHex(String(saltOverride)) : plan.salt;
  const deploymentSalt = deriveDeploymentSalt(plan.root, salt);
  return {
    factory: normalizeAddress(factoryAddress),
    planRoot: plan.root,
    salt,
    deploymentSalt,
    address: computeCreate3(factoryAddress, deploymentSalt),
  };
}

/**
 * Return the inclusion proof for a specific chain id from a spec.
 *
 * @param {object} spec JSON spec passed to {@link buildPlanFromSpec}.
 * @param {string|number|bigint} chainId Target chain identifier.
 * @returns {{root: string, chainId: string, nextChainId: string, prefix: string, initCode: string, initCodeHash: string, leafHash: string, proof: Array<string>, salt: string}}
 */
function getChainProof(spec, chainId) {
  const plan = buildPlanFromSpec(spec);
  const desired = parseChainIdInput(chainId);
  const leaf = plan.leaves.find((entry) => BigInt(entry.chainId) === desired);
  if (!leaf) {
    throw new Error(`No chain entry found for id ${chainId}`);
  }
  return {
    root: plan.root,
    chainId: leaf.chainId,
    nextChainId: leaf.nextChainId,
    prefix: leaf.prefix,
    initCode: leaf.initCode,
    initCodeHash: leaf.initCodeHash,
    leafHash: leaf.leafHash,
    proof: leaf.proof,
    salt: plan.salt,
  };
}

/**
 * Compute the CREATE3 child address for a factory + deployment salt pair.
 *
 * @param {string} factoryAddress Address of the CREATE3 factory.
 * @param {string|Buffer} deploymentSalt Hex string or 32-byte buffer salt.
 * @returns {string} Hex encoded child address.
 */
function computeCreate3Address(factoryAddress, deploymentSalt) {
  return computeCreate3(factoryAddress, deploymentSalt);
}

module.exports = {
  buildDeploymentPlan,
  packLeafPrefix,
  scratchPackedKeccak,
  keccak256: deploymentPlan.keccak256,
  isChainIdInGap: deploymentPlan.isChainIdInGap,
  describeGapRange: deploymentPlan.describeGapRange,
  buildPlanFromSpec,
  deriveDeploymentSalt,
  computePlanDeployment,
  getChainProof,
  computeCreate3Address,
  getSaltHex,
  normalizeSaltHex,
  ZERO_SALT,
};
