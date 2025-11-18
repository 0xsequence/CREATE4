const fs = require('fs');
const path = require('path');
const { normalizeChainId, chainIdToJsonValue, normalizeBytecode, looksLikeHex, sortChainsById } = require('./utils');

const DEFAULT_WIP_FILENAME = 'deployment-plan.edit.json';

function resolvePlanPath(targetPath) {
  return path.resolve(targetPath || DEFAULT_WIP_FILENAME);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function loadPlan(filePath) {
  const resolved = resolvePlanPath(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`WIP file not found at ${resolved}`);
  }
  const contents = fs.readFileSync(resolved, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new Error(`Unable to parse WIP file: ${err.message}`);
  }

  const plan = {};
  if (hasOwn(parsed, 'name')) {
    plan.name = parsed.name;
  }
  if (hasOwn(parsed, 'description')) {
    plan.description = parsed.description;
  }
  if (hasOwn(parsed, 'version')) {
    plan.version = parsed.version;
  }
  if (hasOwn(parsed, 'salt')) {
    plan.salt = parsed.salt;
  }
  plan.chains = Array.isArray(parsed.chains) ? parsed.chains.map(normalizeChainEntry) : [];
  if (hasOwn(parsed, 'fallbackInitCode') && parsed.fallbackInitCode) {
    plan.fallbackInitCode = normalizeBytecode(parsed.fallbackInitCode);
  } else {
    plan.fallbackInitCode = null;
  }
  return plan;
}

function normalizeChainEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Chain entry at index ${index} is invalid`);
  }
  if (!hasOwn(entry, 'chainId')) {
    throw new Error(`Chain entry at index ${index} is missing chainId`);
  }
  if (!entry.initCode) {
    throw new Error(`Chain entry ${String(entry.chainId)} is missing initCode`);
  }
  const chainId = chainIdToBigInt(entry.chainId, `chain id for entry ${index}`);
  const normalized = {
    chainId: chainIdToJsonValue(chainId),
    initCode: normalizeBytecode(entry.initCode),
  };
  if (hasOwn(entry, 'label')) {
    normalized.label = entry.label;
  }
  return normalized;
}

function savePlan(filePath, plan) {
  const resolved = resolvePlanPath(filePath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  const canonical = planToJson(plan);
  fs.writeFileSync(resolved, JSON.stringify(canonical, null, 2) + '\n');
}

/**
 * Canonical JSON structure persisted to disk:
 * {
 *   name?: string,
 *   description?: string,
 *   version?: string,
 *   salt?: string,
 *   chains: Array<{ chainId: string, initCode: string, label?: string }>,
 *   fallbackInitCode?: string | null
 * }
 */
function planToJson(plan) {
  const canonical = {};
  if (hasOwn(plan, 'name')) {
    canonical.name = plan.name;
  }
  if (hasOwn(plan, 'description')) {
    canonical.description = plan.description;
  }
  if (hasOwn(plan, 'version')) {
    canonical.version = plan.version;
  }
  if (hasOwn(plan, 'salt')) {
    canonical.salt = plan.salt;
  }
  canonical.chains = sortChainsForWrite(plan.chains || []);
  if (hasOwn(plan, 'fallbackInitCode')) {
    canonical.fallbackInitCode = plan.fallbackInitCode;
  } else {
    canonical.fallbackInitCode = null;
  }
  return canonical;
}

function sortChainsForWrite(chains) {
  const copy = (chains || []).map((chain) => {
    const normalized = {
      chainId: chainIdToJsonValue(chainIdToBigInt(chain.chainId)),
      initCode: chain.initCode,
    };
    if (hasOwn(chain, 'label')) {
      normalized.label = chain.label;
    }
    return normalized;
  });

  return sortChainsById(copy);
}

function chainIdToBigInt(value, fieldName = 'chain id') {
  return normalizeChainId(value, fieldName);
}

function parseChainIdInput(raw) {
  if (raw === undefined || raw === null) {
    throw new Error('chain id is required');
  }
  return normalizeChainId(raw, 'chain id');
}

/**
 * Attempt to locate bytecode within the provided payload by:
 *  1. Inspecting structured JSON fields (deployedBytecode, bytecode, initCode, etc.)
 *  2. Falling back to the longest explicit 0x-prefixed literal
 *  3. Finally treating the entire payload as hex if it looks like one
 */
function extractBytecodeFromInput(raw) {
  if (typeof raw !== 'string') {
    throw new Error('input data must be a string');
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('no input data received');
  }

  let candidate = null;
  try {
    const parsed = JSON.parse(trimmed);
    candidate = extractBytecodeFromJson(parsed);
  } catch (err) {
    // not JSON, fallback to raw parsing
  }

  if (!candidate) {
    const hexMatches = trimmed.match(/0x[0-9a-fA-F]+/g);
    if (hexMatches && hexMatches.length > 0) {
      hexMatches.sort((a, b) => b.length - a.length);
      candidate = hexMatches[0];
    } else if (looksLikeHex(trimmed)) {
      candidate = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed : '0x' + trimmed;
    }
  }

  if (!candidate) {
    throw new Error('Unable to locate hex bytecode within the provided input');
  }

  return normalizeBytecode(candidate);
}

function extractBytecodeFromJson(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    if (looksLikeHex(value)) {
      return value;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractBytecodeFromJson(item);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof value === 'object') {
    const preferredKeys = [
      ['deployedBytecode', 'object'],
      ['bytecode', 'object'],
      ['initCode', null],
      ['runtimeBytecode', null],
      ['object', null],
    ];

    for (const [outerKey, nestedKey] of preferredKeys) {
      if (hasOwn(value, outerKey)) {
        const rawField = value[outerKey];
        if (typeof rawField === 'string' && looksLikeHex(rawField)) {
          return rawField;
        }
        if (nestedKey && rawField && typeof rawField === 'object') {
          const nested = rawField[nestedKey];
          if (typeof nested === 'string' && looksLikeHex(nested)) {
            return nested;
          }
        }
      }
    }

    for (const key of Object.keys(value)) {
      const found = extractBytecodeFromJson(value[key]);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

module.exports = {
  DEFAULT_WIP_FILENAME,
  resolvePlanPath,
  loadPlan,
  savePlan,
  chainIdToBigInt,
  parseChainIdInput,
  chainIdToJsonValue,
  normalizeBytecode,
  extractBytecodeFromInput,
};
