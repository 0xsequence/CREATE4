const fs = require('fs');
const path = require('path');
const {
  DEFAULT_WIP_FILENAME,
  resolvePlanPath,
  loadPlan,
  savePlan,
  chainIdToBigInt,
  parseChainIdInput,
  chainIdToJsonValue,
  normalizeBytecode,
  extractBytecodeFromInput,
} = require('./wipBuilder');
const { parseArgs } = require('./argParser');
const { normalizeSaltHex } = require('./salt');
const { sortChainsById } = require('./utils');

function printEditUsage() {
  const lines = `CREATE4-plan edit <subcommand> [options]

Subcommands:
  create      Initialize a new editable plan file (default: ${DEFAULT_WIP_FILENAME})
  meta        Update plan metadata (name, description, version, salt)
  add         Add or replace a chain entry or fallback init code
  remove      Remove a chain entry or clear the fallback init code
  view        Show a summary of the editable plan file
  delete      Delete the editable plan file

Use "CREATE4-plan edit <subcommand> --help" to view flags for a specific command.
`;
  process.stdout.write(lines);
}

function runEditCommand(args) {
  const [command, ...rest] = args;
  if (!command || command === '-h' || command === '--help') {
    printEditUsage();
    return;
  }

  if (command === 'create') {
    runEditCreate(rest);
  } else if (command === 'add') {
    runEditAdd(rest);
  } else if (command === 'remove') {
    runEditRemove(rest);
  } else if (command === 'view') {
    runEditView(rest);
  } else if (command === 'delete') {
    runEditDelete(rest);
  } else if (command === 'meta') {
    runEditMeta(rest);
  } else {
    throw new Error(`Unknown edit subcommand: ${command}`);
  }
}

function runEditCreate(args) {
  const { help, values } = parseArgs(args, [
    { name: 'file', alias: 'f' },
    { name: 'name' },
    { name: 'description' },
    { name: 'version' },
    { name: 'salt' },
    { name: 'force', type: 'boolean' },
  ]);

  if (help) {
    process.stdout.write(
      'Usage: CREATE4-plan edit create [--file <path>] [--name <value>] [--description <value>]\n' +
        '                              [--version <value>] [--salt <0x...>] [--force]\n'
    );
    return;
  }

  const targetPath = resolvePlanPath(values.file);
  if (!values.force && fs.existsSync(targetPath)) {
    throw new Error(`Refusing to overwrite existing edit file at ${targetPath}. Use --force to replace it.`);
  }

  const plan = {
    chains: [],
    fallbackInitCode: null,
  };

  if (values.name !== undefined) {
    plan.name = values.name;
  }
  if (values.description !== undefined) {
    plan.description = values.description;
  }
  if (values.version !== undefined) {
    plan.version = values.version;
  }
  if (values.salt !== undefined) {
    plan.salt = normalizeSaltHex(values.salt);
  }

  savePlan(targetPath, plan);
  process.stdout.write(`Created editable plan at ${targetPath}\n`);
}

function runEditMeta(args) {
  const { help, values } = parseArgs(args, [
    { name: 'file', alias: 'f' },
    { name: 'name' },
    { name: 'description' },
    { name: 'version' },
    { name: 'salt' },
    { name: 'clearName', flag: 'clear-name', type: 'boolean' },
    { name: 'clearDescription', flag: 'clear-description', type: 'boolean' },
    { name: 'clearVersion', flag: 'clear-version', type: 'boolean' },
    { name: 'clearSalt', flag: 'clear-salt', type: 'boolean' },
  ]);

  if (help) {
    process.stdout.write(
      'Usage: CREATE4-plan edit meta [--file <path>] [--name <value>] [--description <value>]\n' +
        '                             [--version <value>] [--salt <0x...>] [--clear-name]\n' +
        '                             [--clear-description] [--clear-version] [--clear-salt]\n'
    );
    return;
  }

  const touched =
    values.name !== undefined ||
    values.description !== undefined ||
    values.version !== undefined ||
    values.salt !== undefined ||
    values.clearName ||
    values.clearDescription ||
    values.clearVersion ||
    values.clearSalt;

  if (!touched) {
    throw new Error('meta command requires at least one change option');
  }

  const targetPath = resolvePlanPath(values.file);
  const plan = loadPlan(targetPath);

  if (values.clearName) {
    delete plan.name;
  } else if (values.name !== undefined) {
    plan.name = values.name;
  }

  if (values.clearDescription) {
    delete plan.description;
  } else if (values.description !== undefined) {
    plan.description = values.description;
  }

  if (values.clearVersion) {
    delete plan.version;
  } else if (values.version !== undefined) {
    plan.version = values.version;
  }

  if (values.clearSalt) {
    delete plan.salt;
  } else if (values.salt !== undefined) {
    plan.salt = normalizeSaltHex(values.salt);
  }

  savePlan(targetPath, plan);
  process.stdout.write(`Updated metadata for ${targetPath}\n`);
}

function runEditAdd(args) {
  const { help, values } = parseArgs(args, [
    { name: 'file', alias: 'f' },
    { name: 'chain' },
    { name: 'label' },
    { name: 'code' },
    { name: 'codeFile', flag: 'code-file' },
    { name: 'stdin', type: 'boolean' },
    { name: 'fallback', type: 'boolean' },
    { name: 'replace', type: 'boolean' },
  ]);

  if (help) {
    process.stdout.write(
      'Usage: CREATE4-plan edit add [--file <path>] (--chain <id> | --fallback) [--label <value>]\n' +
        '                             [--code <0x...> | --code-file <path> | --stdin]\n' +
        '                             [--replace]\n'
    );
    return;
  }

  if (values.code && values.codeFile) {
    throw new Error('Provide bytecode through only one source (inline or file)');
  }
  if (values.fallback && values.chain !== undefined) {
    throw new Error('Cannot combine --chain with --fallback');
  }
  if (!values.fallback && values.chain === undefined) {
    throw new Error('add command requires --chain <id> unless --fallback is specified');
  }

  const targetPath = resolvePlanPath(values.file);
  const plan = loadPlan(targetPath);
  const initCode = gatherBytecodeInput({
    literal: values.code,
    filePath: values.codeFile,
    forceStdin: values.stdin,
    context: values.fallback ? 'fallback init code' : `chain ${values.chain}`,
  });

  if (values.fallback) {
    if (plan.fallbackInitCode && !values.replace) {
      throw new Error('fallback init code already exists. Use --replace to overwrite it.');
    }
    plan.fallbackInitCode = initCode;
    savePlan(targetPath, plan);
    process.stdout.write(`Stored fallback init code (${formatByteLength(initCode)}) in ${targetPath}\n`);
    return;
  }

  const chainId = parseChainIdInput(values.chain);
  const existingIdx = plan.chains.findIndex((entry) => chainIdToBigInt(entry.chainId) === chainId);
  if (existingIdx !== -1 && !values.replace) {
    throw new Error(`Chain ${values.chain} already exists. Use --replace to overwrite it.`);
  }

  const normalizedEntry = {
    chainId: chainIdToJsonValue(chainId),
    initCode,
  };
  if (values.label !== undefined) {
    normalizedEntry.label = values.label;
  }

  if (existingIdx === -1) {
    plan.chains.push(normalizedEntry);
  } else {
    plan.chains[existingIdx] = normalizedEntry;
  }

  savePlan(targetPath, plan);
  process.stdout.write(
    `Stored chain ${values.chain} (${formatByteLength(initCode)})${values.label ? ` [${values.label}]` : ''} in ${targetPath}\n`
  );
}

function runEditRemove(args) {
  const { help, values } = parseArgs(args, [
    { name: 'file', alias: 'f' },
    { name: 'chain' },
    { name: 'fallback', type: 'boolean' },
  ]);

  if (help) {
    process.stdout.write(
      'Usage: CREATE4-plan edit remove [--file <path>] (--chain <id> | --fallback)\n'
    );
    return;
  }

  if (values.chain !== undefined && values.fallback) {
    throw new Error('Provide either --chain <id> or --fallback (but not both)');
  }
  if (values.chain === undefined && !values.fallback) {
    throw new Error('remove command requires --chain <id> unless --fallback is specified');
  }

  const targetPath = resolvePlanPath(values.file);
  const plan = loadPlan(targetPath);

  if (values.fallback) {
    if (!plan.fallbackInitCode) {
      throw new Error('fallback init code is not set');
    }
    plan.fallbackInitCode = null;
    savePlan(targetPath, plan);
    process.stdout.write(`Cleared fallback init code from ${targetPath}\n`);
    return;
  }

  const chainId = parseChainIdInput(values.chain);
  const idx = plan.chains.findIndex((entry) => chainIdToBigInt(entry.chainId) === chainId);
  if (idx === -1) {
    throw new Error(`Chain ${values.chain} does not exist`);
  }
  plan.chains.splice(idx, 1);
  savePlan(targetPath, plan);
  process.stdout.write(`Removed chain ${values.chain} from ${targetPath}\n`);
}

function runEditView(args) {
  const { help, values } = parseArgs(args, [{ name: 'file', alias: 'f' }]);

  if (help) {
    process.stdout.write('Usage: CREATE4-plan edit view [--file <path>]\n');
    return;
  }

  const targetPath = resolvePlanPath(values.file);
  const plan = loadPlan(targetPath);
  const lines = [];
  lines.push(`Plan file   : ${targetPath}`);
  lines.push(`Name        : ${plan.name || 'n/a'}`);
  lines.push(`Version     : ${plan.version || 'n/a'}`);
  lines.push(`Description : ${plan.description || 'n/a'}`);
  lines.push(`Salt        : ${plan.salt || 'n/a'}`);
  const fallbackStatus = plan.fallbackInitCode
    ? `set (${formatByteLength(plan.fallbackInitCode)})`
    : 'not set';
  lines.push(`Fallback    : ${fallbackStatus}`);

  const sortedChains = sortChainsById(plan.chains || []);
  lines.push(`Chains (${sortedChains.length}):`);
  if (sortedChains.length === 0) {
    lines.push('  (none)');
  } else {
    sortedChains.forEach((chain, idx) => {
      const labelInfo = chain.label ? ` label="${chain.label}"` : '';
      lines.push(
        `  [${idx}] chainId=${chain.chainId}${labelInfo} size=${formatByteLength(chain.initCode)}`
      );
    });
  }

  process.stdout.write(lines.join('\n') + '\n');
}

function runEditDelete(args) {
  const { help, values } = parseArgs(args, [{ name: 'file', alias: 'f' }]);

  if (help) {
    process.stdout.write('Usage: CREATE4-plan edit delete [--file <path>]\n');
    return;
  }

  const targetPath = resolvePlanPath(values.file);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`No editable plan file found at ${targetPath}`);
  }
  fs.unlinkSync(targetPath);
  process.stdout.write(`Deleted editable plan at ${targetPath}\n`);
}

function gatherBytecodeInput({ literal, filePath, forceStdin, context }) {
  if (literal && filePath) {
    throw new Error('Provide bytecode from only one source (inline via --code or from --code-file)');
  }
  if (literal) {
    return normalizeBytecode(literal);
  }

  let payload = null;
  if (filePath) {
    const resolved = path.resolve(filePath);
    payload = fs.readFileSync(resolved, 'utf8');
  } else {
    payload = readStdinIfAvailable(forceStdin);
  }

  if (!payload) {
    const suffix = context ? ` for ${context}` : '';
    throw new Error(`No bytecode input provided${suffix}. Use --code, --code-file, or pipe build output via stdin.`);
  }

  return extractBytecodeFromInput(payload);
}

function readStdinIfAvailable(force) {
  if (process.stdin.isTTY && !force) {
    return null;
  }
  try {
    const data = fs.readFileSync(0, 'utf8');
    return data.length === 0 ? null : data;
  } catch (err) {
    if (err.code === 'EAGAIN') {
      return null;
    }
    throw err;
  }
}

function formatByteLength(hexValue) {
  if (!hexValue || typeof hexValue !== 'string') {
    return '0 bytes';
  }
  const normalized = hexValue.startsWith('0x') ? hexValue.slice(2) : hexValue;
  const bytes = Math.floor(normalized.length / 2);
  return `${bytes} byte${bytes === 1 ? '' : 's'}`;
}

module.exports = {
  runEditCommand,
  printEditUsage,
};
