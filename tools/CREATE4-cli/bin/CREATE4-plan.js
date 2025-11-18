#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { buildPlanFromSpec, computePlanDeployment, getChainProof, describeGapRange } = require('../src');
const { parseArgs } = require('../src/argParser');
const { runEditCommand } = require('../src/editCommands');

const DEBUG_ENV_FLAG = 'CREATE4_DEBUG';

function printUsage() {
  const message = `CREATE4-plan <command> [options]

Commands:
  build        Compute the root and inclusion proofs for an input spec
  address      Compute the CREATE3 address for a plan and factory
  proof        Return the inclusion proof for a specific chain id
  view         Print a human readable summary of the plan
  edit         Manage editable plan specs (see "CREATE4-plan edit --help" for subcommands)

Global options:
      --debug             Print stack traces on errors (or set CREATE4_DEBUG=1)
  -h, --help              Show this help message

Run "CREATE4-plan <command> --help" for detailed usage.
`;
  process.stdout.write(message);
}

function parseJsonFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const contents = fs.readFileSync(absolutePath, 'utf8');
  try {
    return JSON.parse(contents);
  } catch (err) {
    throw new Error(`Failed to parse JSON input: ${err.message}`);
  }
}

function writeOutput(data, pretty, outputPath) {
  const serialized = JSON.stringify(data, null, pretty ? 2 : 0);
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), serialized);
  } else {
    process.stdout.write(serialized);
  }
}

function loadSpec(inputPath) {
  if (!inputPath) {
    throw new Error('Missing required --input parameter');
  }
  const spec = parseJsonFile(inputPath);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('Input spec must be a JSON object');
  }
  return spec;
}

function runBuild(args) {
  const { help, values } = parseArgs(args, [
    { name: 'input', alias: 'i' },
    { name: 'output', alias: 'o' },
    { name: 'pretty', type: 'boolean' },
  ]);

  if (help) {
    process.stdout.write('Usage: CREATE4-plan build --input <file> [--output <file>] [--pretty]\n');
    return;
  }

  const spec = loadSpec(values.input);
  const plan = buildPlanFromSpec(spec);
  writeOutput(plan, values.pretty, values.output);
}

function runAddress(args) {
  const { help, values } = parseArgs(args, [
    { name: 'input', alias: 'i' },
    { name: 'factory' },
    { name: 'salt' },
    { name: 'output', alias: 'o' },
    { name: 'pretty', type: 'boolean' },
  ]);

  if (help) {
    process.stdout.write(
      'Usage: CREATE4-plan address --input <spec> --factory <address> [--salt <hex>] [--output <file>] [--pretty]\n'
    );
    return;
  }

  if (!values.factory) {
    throw new Error('Missing required --factory parameter');
  }

  const spec = loadSpec(values.input);
  const output = computePlanDeployment(spec, values.factory, { saltOverride: values.salt });
  writeOutput(output, values.pretty, values.output);
}

function runProof(args) {
  const { help, values } = parseArgs(args, [
    { name: 'input', alias: 'i' },
    { name: 'chain' },
    { name: 'output', alias: 'o' },
    { name: 'pretty', type: 'boolean' },
  ]);

  if (help) {
    process.stdout.write('Usage: CREATE4-plan proof --input <spec> --chain <chain id> [--output <file>] [--pretty]\n');
    return;
  }

  if (values.chain === undefined) {
    throw new Error('proof command requires --chain');
  }

  const spec = loadSpec(values.input);
  const output = getChainProof(spec, values.chain);
  writeOutput(output, values.pretty, values.output);
}

function runView(args) {
  const { help, values } = parseArgs(args, [
    { name: 'input', alias: 'i' },
    { name: 'proofs', type: 'boolean' },
  ]);

  if (help) {
    process.stdout.write('Usage: CREATE4-plan view --input <spec> [--proofs]\n');
    return;
  }

  const spec = loadSpec(values.input);
  const plan = buildPlanFromSpec(spec);

  const lines = [];
  lines.push(`Name         : ${plan.name || 'n/a'}`);
  lines.push(`Version      : ${plan.version || 'n/a'}`);
  lines.push(`Description  : ${plan.description || 'n/a'}`);
  lines.push(`Salt         : ${plan.salt}`);
  lines.push(`Tree root    : ${plan.root}`);
  lines.push('');
  lines.push('Chains:');
  plan.leaves.forEach((leaf, idx) => {
    lines.push(
      `  [${idx}] chainId=${leaf.chainId} next=${leaf.nextChainId} label=${leaf.label || 'n/a'} proofLen=${leaf.proof.length}`
    );
    lines.push(`      ${describeGapRange(leaf.chainId, leaf.nextChainId)}`);
    if (values.proofs) {
      leaf.proof.forEach((p, proofIdx) => {
        lines.push(`      proof[${proofIdx}] = ${p}`);
      });
    }
  });
  lines.push('');
  lines.push(`Fallback: initHash=${plan.fallback.initCodeHash} proofLen=${plan.fallback.proof.length}`);
  if (values.proofs) {
    plan.fallback.proof.forEach((proof, idx) => {
      lines.push(`  fallbackProof[${idx}] = ${proof}`);
    });
  }

  process.stdout.write(lines.join('\n') + '\n');
}

function wantsEnvDebug() {
  const raw = process.env[DEBUG_ENV_FLAG];
  if (!raw) {
    return false;
  }
  const normalized = raw.toLowerCase();
  return normalized !== '0' && normalized !== 'false';
}

function extractDebugFlags(argv) {
  const filtered = [];
  let debugEnabled = wantsEnvDebug();
  for (const arg of argv) {
    if (arg === '--debug') {
      debugEnabled = true;
    } else {
      filtered.push(arg);
    }
  }
  return { args: filtered, debugEnabled };
}

function main() {
  const { args, debugEnabled } = extractDebugFlags(process.argv.slice(2));
  const [command, ...rest] = args;

  if (!command || command === '-h' || command === '--help') {
    printUsage();
    return;
  }

  try {
    if (command === 'build') {
      runBuild(rest);
    } else if (command === 'address') {
      runAddress(rest);
    } else if (command === 'proof') {
      runProof(rest);
    } else if (command === 'view') {
      runView(rest);
    } else if (command === 'edit') {
      runEditCommand(rest);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } catch (err) {
    const baseMessage = `Error: ${err.message}`;
    if (debugEnabled && err && err.stack) {
      process.stderr.write(`${baseMessage}\n${err.stack}\n`);
    } else {
      process.stderr.write(`${baseMessage}\n`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
