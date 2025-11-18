const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const {
  buildPlanFromSpec,
  computePlanDeployment,
  getChainProof,
  deriveDeploymentSalt,
  isChainIdInGap,
  describeGapRange,
} = require('../src');
const { getSaltHex, normalizeSaltHex } = require('../src/salt');
const { sortChainsById, normalizeBytecode } = require('../src/utils');
const { parseChainIdInput } = require('../src/wipBuilder');

const CLI_ROOT = path.resolve(__dirname, '..');
const CLI_BIN = path.join(CLI_ROOT, 'bin', 'CREATE4-plan.js');
const ZERO_SALT = '0x' + '00'.repeat(32);

function runCli(args, { input, env } = {}) {
  return execFileSync('node', [CLI_BIN, ...args], {
    cwd: CLI_ROOT,
    encoding: 'utf8',
    input: input ?? undefined,
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function expectCliFailure(args, expectedMessage, { input, env } = {}) {
  const result = spawnSync('node', [CLI_BIN, ...args], {
    cwd: CLI_ROOT,
    encoding: 'utf8',
    input: input ?? undefined,
    env: env ? { ...process.env, ...env } : process.env,
  });
  assert.notStrictEqual(result.status, 0, `Command ${args.join(' ')} unexpectedly succeeded`);
  const combined = (result.stderr || '') + (result.stdout || '');
  assert(
    combined.includes(expectedMessage),
    `Expected failure message "${expectedMessage}" in output: ${combined}`
  );
  return combined;
}

function writeTempFile(dir, filename, contents) {
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, contents);
  return fullPath;
}

function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'CREATE4-cli-smoke-'));
  try {
    expectCliFailure(['build'], 'Missing required --input parameter');

    const arraySpec = writeTempFile(tmpDir, 'array-spec.json', '[]');
    expectCliFailure(['build', '--input', arraySpec], 'Input spec must be a JSON object');

    expectCliFailure(['build', '--unknown'], 'Unknown option: --unknown');

    const sampleSpec = {
      chains: [
        { chainId: 5, initCode: '0x60006000' },
        { chainId: 1, initCode: '0x60016001', label: 'chain-one' },
      ],
      fallbackInitCode: '0x6000600055',
    };
    const specFile = writeTempFile(tmpDir, 'sample-spec.json', JSON.stringify(sampleSpec, null, 2));

    const buildOutput = JSON.parse(runCli(['build', '--input', specFile]));
    assert.strictEqual(
      buildOutput.root,
      '0xeaa21d174c6c5a531b2047c669f483bdddca5d8b22b0131cb4fc2a71681ea8cf',
      'plan root mismatch'
    );
    assert.strictEqual(buildOutput.salt, ZERO_SALT, 'salt should default to zero');
    assert.strictEqual(buildOutput.leaves.length, 2, 'expected two leaves');

    const viewOutput = runCli(['view', '--input', specFile, '--proofs']);
    assert(viewOutput.includes('proof['), 'view --proofs should print proof elements');

    const addressOutput = JSON.parse(
      runCli(['address', '--input', specFile, '--factory', '0x1111111111111111111111111111111111111111'])
    );
    assert.strictEqual(addressOutput.address, '0x94623e185bcb9e65925347d0d1240e9f03c05dbe');
    assert.strictEqual(
      addressOutput.deploymentSalt,
      '0xc26b0098f0368e550717d0c98859be4f40dd91cf83d5b6546e9172a22c73453c'
    );
    const libPlan = buildPlanFromSpec(sampleSpec);
    assert.strictEqual(libPlan.root, buildOutput.root, 'library build should match CLI root');
    assert.strictEqual(libPlan.salt, buildOutput.salt, 'library salt should match CLI output');
    const libDeployment = computePlanDeployment(sampleSpec, '0x1111111111111111111111111111111111111111');
    assert.strictEqual(libDeployment.address, addressOutput.address, 'library address should match CLI');
    assert.strictEqual(
      libDeployment.deploymentSalt,
      addressOutput.deploymentSalt,
      'library deployment salt should match CLI output'
    );
    assert.strictEqual(
      deriveDeploymentSalt(libPlan.root, libPlan.salt),
      libDeployment.deploymentSalt,
      'derived salt helper should align with deployment computation'
    );
    const proofEntry = getChainProof(sampleSpec, 5);
    assert.strictEqual(proofEntry.chainId, '5', 'library proof should target requested chain');
    assert.strictEqual(proofEntry.root, buildOutput.root, 'library proof should reuse plan root');
    assert(Array.isArray(proofEntry.proof) && proofEntry.proof.length > 0, 'proof should contain sibling hashes');

    const hugeChainId = (1n << 63n) + 123n;
    const hugeSpec = {
      chains: [
        { chainId: hugeChainId.toString(), initCode: '0x600a600a' },
        { chainId: (hugeChainId + 2n).toString(), initCode: '0x600b600b' },
      ],
      fallbackInitCode: '0x600c600c',
    };
    const hugeSpecFile = writeTempFile(tmpDir, 'huge-spec.json', JSON.stringify(hugeSpec, null, 2));
    const hugePlan = JSON.parse(runCli(['build', '--input', hugeSpecFile]));
    assert.strictEqual(
      hugePlan.leaves[0].chainId,
      hugeChainId.toString(),
      'CLI build output should preserve full-precision chain ids'
    );
    const hugeProof = getChainProof(hugeSpec, hugeChainId.toString());
    assert.strictEqual(
      hugeProof.chainId,
      hugeChainId.toString(),
      'Library proof should support uint64-sized chain ids via string input'
    );

    expectCliFailure(['proof', '--input', specFile], 'proof command requires --chain');

    const editPlan = path.join(tmpDir, 'deployment-plan.edit.json');
    runCli(['edit', 'create', '--file', editPlan, '--name', 'demo', '--force']);
    runCli(['edit', 'add', '--file', editPlan, '--chain', '111', '--code', '0x6000']);
    const editView = runCli(['edit', 'view', '--file', editPlan]);
    assert(editView.includes('chainId=111'), 'edit view should list added chain');
    runCli(['edit', 'remove', '--file', editPlan, '--chain', '111']);

    const normalizedSalt = normalizeSaltHex('0x' + 'aa'.repeat(32));
    assert.strictEqual(normalizedSalt, '0x' + 'aa'.repeat(32));
    assert.strictEqual(getSaltHex({}, null), ZERO_SALT);
    assert.strictEqual(
      getSaltHex({ salt: '0x' + 'bb'.repeat(32) }),
      '0x' + 'bb'.repeat(32),
      'spec-provided salt should be used'
    );
    assert.throws(() => normalizeSaltHex('0x1234'), /32-byte/);

    const sorted = sortChainsById([
      { chainId: '0x2' },
      { chainId: 1n },
      { chainId: 3 },
    ]);
    assert.deepStrictEqual(
      sorted.map((entry) => String(entry.chainId)),
      ['1', '0x2', '3'],
      'sortChainsById should order by normalized bigint values'
    );
    assert.strictEqual(isChainIdInGap(25, 1, 120), true, 'wrap gap should include high chain ids');
    assert.strictEqual(isChainIdInGap(25, 1, 20), false, 'wrap gap should exclude interior ids');
    assert(describeGapRange(25, 1).includes('wrap gap'), 'gap description should mention wrap behavior');
    assert(
      describeGapRange(10, 25).includes('gap'),
      'non-wrap gap description should still mention the allowed interval'
    );
    assert.strictEqual(isChainIdInGap(5, 5, 6), true, 'single-entry plan should allow other chains');
    assert.strictEqual(isChainIdInGap(5, 5, 5), false, 'single-entry plan should reject the matching chain id');
    assert(
      describeGapRange(5, 5).includes('target != 5'),
      'single-entry gap description should mention exclusion of the chain id'
    );

    const normalizationSpec = {
      chains: [
        { chainId: 2, initCode: '0X600a600b', label: 'upper' },
        { chainId: 3, initCode: '  0x600c 600d  ', label: 'spaced' },
      ],
      fallbackInitCode: '\n0x60FF6000\n',
    };
    const normalizationFile = writeTempFile(tmpDir, 'normalization-spec.json', JSON.stringify(normalizationSpec, null, 2));
    const normalizationPlan = JSON.parse(runCli(['build', '--input', normalizationFile]));
    normalizationSpec.chains.forEach((chain, idx) => {
      assert.strictEqual(
        normalizationPlan.leaves[idx].initCode,
        normalizeBytecode(chain.initCode),
        `init code should be normalized for chain ${chain.chainId}`
      );
    });
    assert.strictEqual(
      normalizationPlan.fallback.initCode,
      normalizeBytecode(normalizationSpec.fallbackInitCode),
      'fallback init code should remain normalized'
    );

    const duplicateSpec = writeTempFile(
      tmpDir,
      'duplicate-spec.json',
      JSON.stringify(
        {
          chains: [
            { chainId: 10, initCode: '0x6000' },
            { chainId: '00010', initCode: '0x6001' },
          ],
          fallbackInitCode: '0x6002',
        },
        null,
        2
      )
    );
    expectCliFailure(['build', '--input', duplicateSpec], 'duplicate chain ids are not allowed');

    const saltSpec = writeTempFile(
      tmpDir,
      'salt-spec.json',
      JSON.stringify(
        {
          salt: '0x' + '11'.repeat(32),
          chains: [
            { chainId: 6, initCode: '0x6000' },
            { chainId: 7, initCode: '0x6001' },
          ],
          fallbackInitCode: '0x6002',
        },
        null,
        2
      )
    );
    const overrideSalt = '  0x' + 'AA'.repeat(32) + '  ';
    const overrideOutput = JSON.parse(
      runCli([
        'address',
        '--input',
        saltSpec,
        '--factory',
        '0x2222222222222222222222222222222222222222',
        '--salt',
        overrideSalt,
      ])
    );
    assert.strictEqual(
      overrideOutput.salt,
      normalizeSaltHex(overrideSalt),
      'CLI salt override should take precedence over spec'
    );

    const complexSorted = sortChainsById([
      { chainId: '00010', marker: 'leading-zero' },
      { chainId: '0x0a', marker: 'hex-ten' },
      { chainId: 1n, marker: 'one' },
      { chainId: BigInt(Number.MAX_SAFE_INTEGER) + 5n, marker: 'big' },
    ]);
    assert.strictEqual(complexSorted[0].marker, 'one', 'chainId=1 should sort first');
    assert.strictEqual(complexSorted[complexSorted.length - 1].marker, 'big', 'bigint chain should sort last');
    const tenMarkers = complexSorted.slice(1, -1).map((entry) => entry.marker).sort();
    assert.deepStrictEqual(tenMarkers, ['hex-ten', 'leading-zero'], 'different encodings of 10 should group together');

    assert.throws(() => parseChainIdInput('abc'), /invalid chain id/i, 'non-numeric strings should fail');
    assert.throws(() => parseChainIdInput('1.5'), /invalid chain id/i, 'float strings should fail');
    assert.throws(() => parseChainIdInput('-1'), /must fit within uint64/i, 'negative chain ids should fail');
    assert.throws(() => parseChainIdInput('   '), /cannot be empty/i, 'empty chain ids should fail');

    const noDebugOutput = expectCliFailure(['bogus-cmd'], 'Unknown command: bogus-cmd');
    assert(!noDebugOutput.includes('at '), 'stack trace should be hidden by default');
    const envDebugOutput = expectCliFailure(['bogus-cmd'], 'Unknown command: bogus-cmd', {
      env: { CREATE4_DEBUG: '1' },
    });
    assert(envDebugOutput.includes('at '), 'CREATE4_DEBUG=1 should enable stack traces');
    const flagDebugOutput = expectCliFailure(['--debug', 'bogus-cmd'], 'Unknown command: bogus-cmd');
    assert(flagDebugOutput.includes('at '), '--debug flag should enable stack traces');

    const missingBytecodePlan = path.join(tmpDir, 'missing-bytecode.edit.json');
    runCli(['edit', 'create', '--file', missingBytecodePlan, '--force']);
    expectCliFailure(
      ['edit', 'add', '--file', missingBytecodePlan, '--chain', '1'],
      'No bytecode input provided for chain 1'
    );

    const stdinPlan = path.join(tmpDir, 'stdin-bytecode.edit.json');
    runCli(['edit', 'create', '--file', stdinPlan, '--force']);
    expectCliFailure(
      ['edit', 'add', '--file', stdinPlan, '--chain', '2', '--stdin'],
      'Unable to locate hex bytecode within the provided input',
      { input: 'not-hex-data' }
    );

    const fallbackPlan = path.join(tmpDir, 'fallback-plan.edit.json');
    runCli(['edit', 'create', '--file', fallbackPlan, '--force']);
    runCli(['edit', 'add', '--file', fallbackPlan, '--fallback', '--code', '0x6000']);
    expectCliFailure(
      ['edit', 'add', '--file', fallbackPlan, '--fallback', '--code', '0x6001'],
      'fallback init code already exists'
    );
    runCli(['edit', 'add', '--file', fallbackPlan, '--fallback', '--code', '0x6002', '--replace']);

    const metaPlan = path.join(tmpDir, 'meta-plan.edit.json');
    runCli(['edit', 'create', '--file', metaPlan, '--force']);
    expectCliFailure(['edit', 'meta', '--file', metaPlan], 'meta command requires at least one change option');
    expectCliFailure(['edit', 'remove', '--file', metaPlan, '--chain', '999'], 'Chain 999 does not exist');
    expectCliFailure(['edit', 'remove', '--file', metaPlan, '--fallback'], 'fallback init code is not set');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('CREATE4-plan CLI smoke tests passed');
}

main();
