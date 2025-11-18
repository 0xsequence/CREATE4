// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Test, stdJson} from "forge-std/Test.sol";

import {CREATE4} from "src/CREATE4.sol";
import {CREATE3} from "src/CREATE3.sol";

contract CREATE4Harness is CREATE4 {
  function packLeafPrefixExternal(uint64 chainid, uint64 nextChainid, uint8 isFallback) external pure returns (bytes32) {
    return packLeafPrefix(chainid, nextChainid, isFallback);
  }

  function decodeLeafPrefixExternal(bytes32 leaf) external pure returns (uint64 chainid, uint64 nextChainid, uint8 isFallback) {
    return decodeLeafPrefix(leaf);
  }
}

contract Create3Harness {
  function deploy(bytes32 salt, bytes memory initCode) external returns (address addr) {
    return CREATE3.create3(salt, initCode);
  }

  function computeAddress(bytes32 salt) external view returns (address) {
    return CREATE3.addressOf(salt);
  }
}

contract RevertingConstructor {
  constructor() {
    revert("constructor failure");
  }
}

error UnexpectedDeploymentValue(uint256 expected, uint256 actual);

contract ValueExpectingContract {
  uint256 public deployedValue;

  constructor(uint256 expected) payable {
    if (msg.value != expected) {
      revert UnexpectedDeploymentValue(expected, msg.value);
    }
    deployedValue = msg.value;
  }
}

contract NonPayableValueContract {
  constructor() {}
}

contract CREATE4Test is Test {
  using stdJson for string;

  bytes16 private constant HEX_SYMBOLS = 0x30313233343536373839616263646566;
  uint64 private constant MAX_CHAIN_ID = type(uint64).max;
  bytes32 private constant KECCAK256_PROXY_CHILD_BYTECODE =
    0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f;
  uint64 private constant GAP_CHAIN_ID = 10;
  uint64 private constant GAP_TARGET_CHAIN_ID = 19;
  uint64 private constant VALUE_PLAN_CHAIN_ID = 50;
  uint64 private constant VALUE_PLAN_NEXT_CHAIN_ID = 80;
  uint64 private constant VALUE_PLAN_TARGET_CHAIN_ID = 60;

  CREATE4 internal create4;
  CREATE4Harness internal create4Harness;
  Create3Harness internal create3Harness;
  string internal cliScript;
  uint256 internal specNonce;

  bytes32 internal salt;
  bytes32 internal planRoot;
  LeafData[] internal leaves;
  bytes internal fallbackInitCode;
  bytes32[] internal fallbackProof;
  FallbackCase internal fallbackCase;
  bytes32 internal fallbackPrefix;
  bytes32 internal fallbackInitHash;

  struct LeafData {
    uint64 chainId;
    uint64 nextChainId;
    bytes initCode;
    bytes32 initCodeHash;
    bytes32 prefix;
    bytes32[] proof;
  }

  struct FallbackJson {
    uint64 chainId;
    bytes initCode;
    bytes32 initCodeHash;
    bytes32 leafHash;
    uint64 nextChainId;
    bytes32 prefix;
    bytes32[] proof;
  }


  struct FallbackCase {
    uint64 targetChainId;
    bytes32 gapLeafPrefix;
    bytes32 gapLeafHash;
    bytes32[] gapProof;
    bytes32[] fallbackProof;
  }

  struct ManualHighPlan {
    uint64 chainIdA;
    uint64 chainIdB;
    bytes32 prefixA;
    bytes32 prefixB;
    bytes32 fallbackPrefix;
    LeafData[] leaves;
    FallbackJson fallbackData;
    bytes32 expectedRoot;
  }

  struct ChainInput {
    uint64 chainId;
    bytes initCode;
    string label;
  }


  function setUp() public {
    create4 = new CREATE4();
    create4Harness = new CREATE4Harness();
    create3Harness = new Create3Harness();
    cliScript = string.concat(vm.projectRoot(), "/tools/CREATE4-cli/bin/CREATE4-plan.js");
    vm.createDir(string.concat(vm.projectRoot(), "/cache"), true);

    string memory specPath = string.concat(vm.projectRoot(), "/test/fixtures/sample-plan.json");
    string memory planJson = runCliBuild(specPath);
    loadPlanFromJson(planJson);
    prepareFallbackCase();
  }

  function testDeploysAlphaVersion() public {
    LeafData memory leaf = findLeaf(1);
    vm.chainId(leaf.chainId);

    bytes32[] memory proof = copyProof(leaf.proof);
    address deployed = create4.deploy(proof, leaf.initCode, leaf.nextChainId, salt);

    assertEq(readWord(deployed), 1, "alpha deployment should return constant 1");
  }

  function testDeploysGammaVersionWithWrappedNextChain() public {
    LeafData memory leaf = findLeaf(25);
    vm.chainId(leaf.chainId);

    bytes32[] memory proof = copyProof(leaf.proof);
    address deployed = create4.deploy(proof, leaf.initCode, leaf.nextChainId, salt);

    assertEq(readWord(deployed), 3, "gamma deployment should return constant 3");
  }

  function testDeploysFallbackThroughGapProof() public {
    vm.chainId(fallbackCase.targetChainId);

    bytes32[] memory gapProof = copyProof(fallbackCase.gapProof);
    bytes32[] memory proof = copyProof(fallbackCase.fallbackProof);

    address deployed = create4.deployFallback(
      fallbackCase.gapLeafPrefix,
      fallbackCase.gapLeafHash,
      gapProof,
      proof,
      fallbackInitCode,
      salt
    );

    assertEq(readWord(deployed), 255, "fallback deployment should return constant 255");
  }

  function testDeployFallbackRevertsForInvalidGap() public {
    LeafData memory alpha = findLeaf(1);
    vm.chainId(fallbackCase.targetChainId);

    bytes32[] memory gapProof = copyProof(alpha.proof);
    bytes32[] memory proof = copyProof(fallbackCase.fallbackProof);

    vm.expectRevert(CREATE4.InvalidProvidedGap.selector);
    create4.deployFallback(
      alpha.prefix,
      alpha.initCodeHash,
      gapProof,
      proof,
      fallbackInitCode,
      salt
    );
  }

  function testFuzzPlanMatchesCli(
    uint64 chainIdA,
    uint64 chainIdB,
    uint8 valueA,
    uint8 valueB,
    uint8 fallbackValue,
    bytes32 saltSeed
  ) public {
    vm.assume(chainIdA > 0 && chainIdB > 0);
    vm.assume(chainIdA != chainIdB);

    bytes32 planSalt = keccak256(abi.encodePacked(saltSeed, chainIdA, chainIdB, valueA, valueB, fallbackValue));
    string memory planJson = runCliOrSkip(
      writeSpecToCache(
        buildSpecJson(
          chainIdA,
          constantInitCode(valueA),
          chainIdB,
          constantInitCode(valueB),
          constantInitCode(fallbackValue),
          planSalt
        )
      )
    );

    bytes32 computedSalt = planJson.readBytes32(".salt");
    require(computedSalt != bytes32(0), "CLI did not return a salt");

    (LeafData[] memory planLeaves,) = decodePlanToMemory(planJson);
    (bool found, LeafData memory targetLeaf) = findLeafOptional(planLeaves, chainIdA);
    if (!found) {
      (found, targetLeaf) = findLeafOptional(planLeaves, chainIdB);
    }
    if (!found) {
      require(planLeaves.length > 0, "no leaves");
      targetLeaf = planLeaves[0];
    }

    vm.chainId(targetLeaf.chainId);
    address deployed = create4.deploy(
      copyProof(targetLeaf.proof),
      targetLeaf.initCode,
      targetLeaf.nextChainId,
      computedSalt
    );

    assertEq(readWord(deployed), uint256(valueA), "CLI proof should deploy constant for chainIdA");
  }

  function testFuzzPlanDeploysAllLeaves(uint256 seed, uint8 leafCountRaw) public {
    uint256 leafCount = bound(uint256(leafCountRaw), 2, 6);
    string memory specJson = generatePlanSpec(seed, leafCount);
    string memory planJson = runCliOrSkip(writeSpecToCache(specJson));
    bytes32 planRootLocal = planJson.readBytes32(".root");
    bytes32 planSaltLocal = planJson.readBytes32(".salt");

    (LeafData[] memory planLeaves,) = decodePlanToMemory(planJson);
    for (uint256 i = 0; i < planLeaves.length; i++) {
      LeafData memory leaf = planLeaves[i];
      vm.chainId(leaf.chainId);
      bytes32 leafSalt = keccak256(abi.encodePacked(planSaltLocal, leaf.chainId, i));
      address deployed = create4.deploy(copyProof(leaf.proof), leaf.initCode, leaf.nextChainId, leafSalt);

      uint8 expectedValue = decodeConstant(leaf.initCode);
      assertEq(readWord(deployed), expectedValue, "incorrect value for chain");

      bytes32 computedRoot = computeRootFromLeaf(leaf);
      assertEq(computedRoot, planRootLocal, "proof should match plan root");

      address expectedAddress = computeCreate3AddressFromRoot(address(create4), computedRoot, leafSalt);
      assertEq(deployed, expectedAddress, "deployment address mismatch");
    }
  }

  function testFuzzFallbackDeploysCorrectly(uint256 seed, uint8 leafCountRaw, uint64 entropy) public {
    uint256 leafCount = bound(uint256(leafCountRaw), 2, 6);
    string memory specJson = generatePlanSpec(seed, leafCount);
    string memory planJson = runCliOrSkip(writeSpecToCache(specJson));
    bytes32 planRootLocal = planJson.readBytes32(".root");
    bytes32 planSaltLocal = planJson.readBytes32(".salt");

    (LeafData[] memory planLeaves, FallbackJson memory fallbackData) = decodePlanToMemory(planJson);
    uint256 gapIndex = uint256(entropy) % planLeaves.length;
    LeafData memory gapLeaf = planLeaves[gapIndex];

    entropy ^= uint64(0x5a5a5a5a5a5a5a5a);
    uint64 targetChainId = computeGapTarget(gapLeaf.chainId, gapLeaf.nextChainId, entropy);
    vm.chainId(targetChainId);

    bytes32[] memory gapProof = copyProof(gapLeaf.proof);
    bytes32[] memory fallbackProofCopy = copyProof(fallbackData.proof);

    address deployed = create4.deployFallback(
      gapLeaf.prefix,
      gapLeaf.initCodeHash,
      gapProof,
      fallbackProofCopy,
      fallbackData.initCode,
      planSaltLocal
    );

    assertEq(readWord(deployed), decodeConstant(fallbackData.initCode), "fallback return mismatch");

    bytes32 computedRoot = computeRootFromLeaf(gapLeaf);
    assertEq(computedRoot, planRootLocal, "gap root mismatch");

    bytes32 fallbackRoot = computeFallbackRoot(fallbackData);
    assertEq(fallbackRoot, planRootLocal, "fallback proof mismatch");

    address expectedAddress = computeCreate3AddressFromRoot(address(create4), planRootLocal, planSaltLocal);
    assertEq(deployed, expectedAddress, "fallback address mismatch");
  }

  function testDeployFallbackRevertsForCorruptedProof() public {
    vm.chainId(fallbackCase.targetChainId);

    bytes32[] memory gapProof = copyStorageProofToMemory(fallbackCase.gapProof);
    bytes32[] memory fallbackProofCopy = copyStorageProofToMemory(fallbackCase.fallbackProof);
    fallbackProofCopy[0] = bytes32(uint256(fallbackProofCopy[0]) ^ 0x01);

    vm.expectRevert(CREATE4.MismatchedProof.selector);
    create4.deployFallback(
      fallbackCase.gapLeafPrefix,
      fallbackCase.gapLeafHash,
      gapProof,
      fallbackProofCopy,
      fallbackInitCode,
      salt
    );
  }

  function testDeployFallbackRevertsWhenGapIsFallback() public {
    vm.chainId(fallbackCase.targetChainId);

    vm.expectRevert(CREATE4.GapCannotBeFallback.selector);
    create4.deployFallback(
      fallbackPrefix,
      fallbackInitHash,
      copyStorageProofToMemory(fallbackCase.fallbackProof),
      copyStorageProofToMemory(fallbackCase.fallbackProof),
      fallbackInitCode,
      salt
    );
  }

  function testDeployFallbackWrapRevertsOutsideRange() public {
    LeafData memory wrapLeaf = findLeaf(25);
    vm.chainId(15);

    vm.expectRevert(CREATE4.InvalidProvidedGap.selector);
    create4.deployFallback(
      wrapLeaf.prefix,
      wrapLeaf.initCodeHash,
      copyProof(wrapLeaf.proof),
      copyStorageProofToMemory(fallbackCase.fallbackProof),
      fallbackInitCode,
      salt
    );
  }

  function testDeployFallbackWrapSucceedsWithinRange() public {
    LeafData memory wrapLeaf = findLeaf(25);
    uint64 targetChainId = 120;
    vm.chainId(targetChainId);

    FallbackCase memory wrapCase = buildFallbackCaseFromLeaf(wrapLeaf, targetChainId);
    address deployed = create4.deployFallback(
      wrapCase.gapLeafPrefix,
      wrapCase.gapLeafHash,
      wrapCase.gapProof,
      wrapCase.fallbackProof,
      fallbackInitCode,
      salt
    );

    assertEq(readWord(deployed), decodeConstant(fallbackInitCode), "fallback value mismatch");

    address expectedAddress = computeCreate3AddressFromRoot(address(create4), planRoot, salt);
    assertEq(deployed, expectedAddress, "wrap fallback address mismatch");
  }

  function testDeployFallbackSingleLeafPlanAllowsFallbackOnOtherChains() public {
    (
      LeafData memory singleLeaf,
      FallbackJson memory fallbackData,
      bytes32 saltLocal,
      bytes32 planRootLocal
    ) = buildSingleLeafPlan();
    assertEq(singleLeaf.chainId, singleLeaf.nextChainId, "single leaf should wrap to itself");

    uint64 targetChainId = computeGapTarget(singleLeaf.chainId, singleLeaf.nextChainId, 0x12345678);
    require(targetChainId != singleLeaf.chainId, "target chain id should differ from leaf chain id");
    vm.chainId(targetChainId);

    address deployed = create4.deployFallback(
      singleLeaf.prefix,
      singleLeaf.initCodeHash,
      copyProof(singleLeaf.proof),
      copyProof(fallbackData.proof),
      fallbackData.initCode,
      saltLocal
    );

    assertEq(readWord(deployed), decodeConstant(fallbackData.initCode), "single leaf fallback return mismatch");
    address expectedAddress = computeCreate3AddressFromRoot(address(create4), planRootLocal, saltLocal);
    assertEq(deployed, expectedAddress, "single leaf fallback address mismatch");
  }

  function testDeployFallbackSingleLeafPlanRejectsMatchingChain() public {
    (LeafData memory singleLeaf, FallbackJson memory fallbackData, bytes32 saltLocal,) = buildSingleLeafPlan();
    vm.chainId(singleLeaf.chainId);

    vm.expectRevert(CREATE4.InvalidProvidedGap.selector);
    create4.deployFallback(
      singleLeaf.prefix,
      singleLeaf.initCodeHash,
      copyProof(singleLeaf.proof),
      copyProof(fallbackData.proof),
      fallbackData.initCode,
      saltLocal
    );
  }

  function testDeployWithCorruptedProofChangesAddress() public {
    LeafData memory leaf = findLeaf(10);
    vm.chainId(leaf.chainId);

    bytes32[] memory corruptedProof = copyProof(leaf.proof);
    corruptedProof[0] = bytes32(uint256(corruptedProof[0]) ^ 0x01);

    address deployed = create4.deploy(corruptedProof, leaf.initCode, leaf.nextChainId, salt);

    assertEq(readWord(deployed), decodeConstant(leaf.initCode), "runtime mismatch for corrupted proof");

    bytes32 actualRoot = computeRootFromLeaf(leaf);
    assertEq(actualRoot, planRoot, "proof mismatch for plan root");

    bytes32 mutatedRoot = scratchPacked(leaf.prefix, leaf.initCodeHash);
    for (uint256 i = 0; i < corruptedProof.length; i++) {
      mutatedRoot = commutative(mutatedRoot, corruptedProof[i]);
    }
    assertTrue(mutatedRoot != planRoot, "mutated proof should diverge from plan root");

    address expectedAddress = computeCreate3AddressFromRoot(address(create4), planRoot, salt);
    assertTrue(deployed != expectedAddress, "deployed address should not match plan root address");
  }

  function testDeployWithWrongNextChainIdChangesAddress() public {
    LeafData memory leaf = findLeaf(1);
    vm.chainId(leaf.chainId);

    uint64 wrongNextChainId = leaf.nextChainId == type(uint64).max ? leaf.nextChainId - 1 : leaf.nextChainId + 1;

    address deployed = create4.deploy(copyProof(leaf.proof), leaf.initCode, wrongNextChainId, salt);
    assertEq(readWord(deployed), decodeConstant(leaf.initCode), "init code should still execute");

    address expectedAddress = computeCreate3AddressFromRoot(address(create4), planRoot, salt);
    assertTrue(deployed != expectedAddress, "next chain mismatch should alter address");
  }

  function testDeployWithWrongInitCodeChangesRoot() public {
    LeafData memory leaf = findLeaf(10);
    vm.chainId(leaf.chainId);

    uint8 mutatedValue = decodeConstant(leaf.initCode) + 1;
    bytes memory mutatedInit = constantInitCode(mutatedValue);

    address deployed = create4.deploy(copyProof(leaf.proof), mutatedInit, leaf.nextChainId, salt);
    assertEq(readWord(deployed), mutatedValue, "mutated runtime should return new constant");

    LeafData memory mutatedLeaf = leaf;
    mutatedLeaf.initCode = mutatedInit;
    mutatedLeaf.initCodeHash = keccak256(mutatedInit);
    bytes32 mutatedRoot = computeRootFromLeaf(mutatedLeaf);
    assertTrue(mutatedRoot != planRoot, "mutated init code should alter root");
  }

  function testPackLeafPrefixHandlesHighUint64Values() public view {
    ManualHighPlan memory plan = buildManualHighPlan();
    assertPrefixDecodes(plan.prefixA, plan.chainIdA, plan.chainIdB, 0);
    assertPrefixDecodes(plan.prefixB, plan.chainIdB, plan.chainIdA, 0);
    assertPrefixDecodes(plan.fallbackPrefix, 0, 0, 1);
  }

  function testManualHighPlanRootsMatchExpected() public view {
    ManualHighPlan memory plan = buildManualHighPlan();
    for (uint256 i = 0; i < plan.leaves.length; i++) {
      bytes32 computedRoot = computeRootFromLeaf(plan.leaves[i]);
      assertEq(computedRoot, plan.expectedRoot, "manual leaf root mismatch");
    }
    bytes32 fallbackRoot = computeFallbackRoot(plan.fallbackData);
    assertEq(fallbackRoot, plan.expectedRoot, "manual fallback root mismatch");
  }

  function testMaxChainIdLeafDeploys() public {
    ChainInput[] memory chains = new ChainInput[](1);
    chains[0] = ChainInput({ chainId: MAX_CHAIN_ID, initCode: constantInitCode(9), label: "max" });
    bytes memory fallbackCode = constantInitCode(11);
    bytes32 planSaltLocal = keccak256("max-safe");

    string memory planJson = runCliBuild(writeSpecToCache(serializePlanSpec(chains, fallbackCode, planSaltLocal)));
    bytes32 planRootLocal = planJson.readBytes32(".root");
    bytes32 saltLocal = planJson.readBytes32(".salt");
    (LeafData[] memory planLeaves,) = decodePlanToMemory(planJson);

    LeafData memory leaf = planLeaves[0];
    (uint64 decodedChain,, uint8 flag) = create4Harness.decodeLeafPrefixExternal(leaf.prefix);
    assertEq(decodedChain, leaf.chainId, "decoded chain mismatch");
    assertEq(decodedChain, MAX_CHAIN_ID, "max chain id mismatch");
    assertEq(flag, 0, "leaf should not be fallback");

    bytes32 computedRoot = computeRootFromLeaf(leaf);
    assertEq(computedRoot, planRootLocal, "computed root mismatch");

    vm.chainId(leaf.chainId);
    address deployed = create4.deploy(copyProof(leaf.proof), leaf.initCode, leaf.nextChainId, saltLocal);
    address expected = computeCreate3AddressFromRoot(address(create4), planRootLocal, saltLocal);
    assertEq(deployed, expected, "deployment address mismatch for safe chain");
  }

  function testCliProofRoundTripDeploysLeaf() public {
    string memory specPath = string.concat(vm.projectRoot(), "/test/fixtures/sample-plan.json");
    string memory proofJson = runCliProof(specPath, 10);

    bytes32 planRootLocal = proofJson.readBytes32(".root");
    bytes32 saltLocal = proofJson.readBytes32(".salt");
    uint64 chainId = parseChainIdString(proofJson.readString(".chainId"));
    uint64 nextChainId = parseChainIdString(proofJson.readString(".nextChainId"));
    bytes memory initCode = proofJson.readBytes(".initCode");
    bytes32 initCodeHash = proofJson.readBytes32(".initCodeHash");
    bytes32 prefix = proofJson.readBytes32(".prefix");
    bytes memory proofRaw = proofJson.parseRaw(".proof");
    bytes32[] memory proof = abi.decode(proofRaw, (bytes32[]));

    LeafData memory leaf = LeafData({
      chainId: chainId,
      nextChainId: nextChainId,
      initCode: initCode,
      initCodeHash: initCodeHash,
      prefix: prefix,
      proof: proof
    });

    vm.chainId(chainId);
    address deployed = create4.deploy(copyProof(leaf.proof), leaf.initCode, leaf.nextChainId, saltLocal);

    bytes32 computedRoot = computeRootFromLeaf(leaf);
    assertEq(computedRoot, planRootLocal, "CLI proof root mismatch");

    address expected = computeCreate3AddressFromRoot(address(create4), planRootLocal, saltLocal);
    assertEq(deployed, expected, "CLI proof deployment mismatch");
  }

  function testCreate3AddressMatchesAddressOf() public {
    bytes32 saltValue = keccak256("create3-address-match");
    bytes memory initCode = constantInitCode(42);

    address predicted = create3Harness.computeAddress(saltValue);
    address deployed = create3Harness.deploy(saltValue, initCode);

    assertEq(deployed, predicted, "create3 address mismatch");
    assertEq(readWord(deployed), 42, "deployed runtime mismatch");
  }

  function testCreate3RevertsWhenTargetAlreadyExists() public {
    bytes32 saltValue = keccak256("create3-target-exists");
    bytes memory initCode = constantInitCode(5);

    create3Harness.deploy(saltValue, initCode);

    vm.expectRevert(CREATE3.TargetAlreadyExists.selector);
    create3Harness.deploy(saltValue, initCode);
  }

  function testCreate3RevertsWhenProxyCreationFails() public {
    bytes32 saltValue = keccak256("create3-proxy-fail");
    bytes memory initCode = constantInitCode(7);
    address proxyAddress = computeCreate3ProxyAddress(address(create3Harness), saltValue);

    vm.etch(proxyAddress, hex"00");
    vm.resetNonce(proxyAddress);

    vm.expectRevert(CREATE3.ErrorCreatingProxy.selector);
    create3Harness.deploy(saltValue, initCode);
  }

  function testCreate3RevertsWhenContractCreationFails() public {
    bytes32 saltValue = keccak256("create3-contract-fail");
    bytes memory revertInit = type(RevertingConstructor).creationCode;

    vm.expectRevert(CREATE3.ErrorCreatingContract.selector);
    create3Harness.deploy(saltValue, revertInit);
  }

  function testPlanRootAndSaltProduceSameAddressAcrossChains() public {
    bytes32 sharedSalt = keccak256("plan-root-salt");
    bytes32 createSalt = scratchPacked(planRoot, sharedSalt);
    address expectedAddress = computeCreate3Address(address(create4), createSalt);
    address proxyAddress = computeCreate3ProxyAddress(address(create4), createSalt);

    for (uint256 i = 0; i < leaves.length; i++) {
      LeafData memory leaf = leaves[i];
      vm.chainId(leaf.chainId);
      address deployed = create4.deploy(copyProof(leaf.proof), leaf.initCode, leaf.nextChainId, sharedSalt);
      assertEq(readWord(deployed), decodeConstant(leaf.initCode), "leaf runtime mismatch");
      assertEq(deployed, expectedAddress, "leaf address mismatch for shared salt");
      clearAddress(deployed);
      clearAddress(proxyAddress);
    }
  }

  function testSaltVariationChangesAddressesOnly() public {
    LeafData memory leaf = findLeaf(1);
    vm.chainId(leaf.chainId);

    bytes32 saltA = keccak256("salt-variation-a");
    bytes32 saltB = keccak256("salt-variation-b");

    address deployedA = create4.deploy(copyProof(leaf.proof), leaf.initCode, leaf.nextChainId, saltA);
    address deployedB = create4.deploy(copyProof(leaf.proof), leaf.initCode, leaf.nextChainId, saltB);

    assertTrue(deployedA != deployedB, "different salts should yield different addresses");
    uint256 returnA = readWord(deployedA);
    uint256 returnB = readWord(deployedB);
    assertEq(returnA, returnB, "runtime should remain identical across salts");
  }

  function testDeployFallbackRevertsForCorruptedGapLeafHash() public {
    vm.chainId(fallbackCase.targetChainId);

    bytes32[] memory gapProof = copyStorageProofToMemory(fallbackCase.gapProof);
    bytes32[] memory fallbackProofCopy = copyStorageProofToMemory(fallbackCase.fallbackProof);
    bytes32 corruptedHash = bytes32(uint256(fallbackCase.gapLeafHash) ^ 0x01);

    vm.expectRevert(CREATE4.MismatchedProof.selector);
    create4.deployFallback(
      fallbackCase.gapLeafPrefix,
      corruptedHash,
      gapProof,
      fallbackProofCopy,
      fallbackInitCode,
      salt
    );
  }

  function testDeployFallbackRevertsForGapPrefixMismatch() public {
    vm.chainId(5);

    LeafData memory alpha = findLeaf(1);
    LeafData memory beta = findLeaf(10);

    bytes32[] memory gapProof = copyProof(beta.proof);
    bytes32[] memory fallbackProofCopy = copyStorageProofToMemory(fallbackCase.fallbackProof);

    vm.expectRevert(CREATE4.MismatchedProof.selector);
    create4.deployFallback(
      alpha.prefix,
      beta.initCodeHash,
      gapProof,
      fallbackProofCopy,
      fallbackInitCode,
      salt
    );
  }

  function testDeployFallbackRevertsWhenGapUnavailable() public {
    ChainInput[] memory chains = new ChainInput[](2);
    chains[0] = ChainInput({ chainId: 10, initCode: constantInitCode(10), label: "tight-0" });
    chains[1] = ChainInput({ chainId: 11, initCode: constantInitCode(11), label: "tight-1" });
    bytes memory fallbackCode = constantInitCode(200);
    bytes32 planSaltLocal = keccak256("tight-gap");

    string memory planJson = runCliBuild(writeSpecToCache(serializePlanSpec(chains, fallbackCode, planSaltLocal)));
    bytes32 saltLocal = planJson.readBytes32(".salt");
    (LeafData[] memory planLeaves, FallbackJson memory fallbackData) = decodePlanToMemory(planJson);

    LeafData memory gapLeaf = planLeaves[0];
    if (gapLeaf.chainId != 10) {
      gapLeaf = planLeaves[1];
    }
    assertEq(gapLeaf.chainId, 10, "gap leaf chain id mismatch");
    assertEq(gapLeaf.nextChainId, 11, "gap next chain id mismatch");

    vm.expectRevert(bytes("no available gap"));
    this.computeGapTargetExternal(gapLeaf.chainId, gapLeaf.nextChainId, 1);

    vm.chainId(gapLeaf.chainId);
    bytes32[] memory gapProof = copyProof(gapLeaf.proof);
    bytes32[] memory fallbackProofCopy = copyProof(fallbackData.proof);

    try create4.deployFallback(
      gapLeaf.prefix,
      gapLeaf.initCodeHash,
      gapProof,
      fallbackProofCopy,
      fallbackData.initCode,
      saltLocal
    ) returns (address) {
      fail("deployFallback should revert when no gap exists");
    } catch (bytes memory revertData) {
      bytes4 selector = bytes4(revertData);
      assertEq(selector, CREATE4.InvalidProvidedGap.selector, "expected InvalidProvidedGap revert");
    }
  }

  function testDeployForwardsValueToPayableLeaf() public {
    uint256 sendValue = 0.25 ether;
    bytes memory leafInit = valueReceiverInit(sendValue);
    (LeafData memory leaf,) = buildManualValuePlan(leafInit, constantInitCode(201));
    vm.chainId(leaf.chainId);
    bytes32 saltLocal = keccak256("deploy-leaf-value");

    address deployed = create4.deploy{ value: sendValue }(
      copyProof(leaf.proof),
      leaf.initCode,
      leaf.nextChainId,
      saltLocal
    );

    assertEq(ValueExpectingContract(deployed).deployedValue(), sendValue, "leaf did not receive value");
  }

  function testDeployHandlesZeroValueForPayableLeaf() public {
    bytes memory leafInit = valueReceiverInit(0);
    (LeafData memory leaf,) = buildManualValuePlan(leafInit, constantInitCode(202));
    vm.chainId(leaf.chainId);
    bytes32 saltLocal = keccak256("deploy-leaf-zero-value");

    address deployed = create4.deploy(
      copyProof(leaf.proof),
      leaf.initCode,
      leaf.nextChainId,
      saltLocal
    );

    assertEq(ValueExpectingContract(deployed).deployedValue(), 0, "leaf should record zero value");
  }

  function testDeployRevertsWhenSendingValueToNonPayableLeaf() public {
    bytes memory leafInit = nonPayableValueInitCode();
    (LeafData memory leaf,) = buildManualValuePlan(leafInit, constantInitCode(203));
    vm.chainId(leaf.chainId);
    bytes32 saltLocal = keccak256("deploy-leaf-nonpayable");

    vm.expectRevert();
    create4.deploy{ value: 1 wei }(
      copyProof(leaf.proof),
      leaf.initCode,
      leaf.nextChainId,
      saltLocal
    );
  }

  function testDeployFallbackForwardsValueToPayableFallback() public {
    uint256 sendValue = 0.5 ether;
    bytes memory fallbackInit = valueReceiverInit(sendValue);
    (LeafData memory gapLeaf, FallbackJson memory fallbackData) =
      buildManualValuePlan(constantInitCode(204), fallbackInit);

    vm.chainId(VALUE_PLAN_TARGET_CHAIN_ID);
    bytes32 saltLocal = keccak256("fallback-payable-value");

    address deployed = create4.deployFallback{ value: sendValue }(
      gapLeaf.prefix,
      gapLeaf.initCodeHash,
      copyProof(gapLeaf.proof),
      copyProof(fallbackData.proof),
      fallbackData.initCode,
      saltLocal
    );

    assertEq(ValueExpectingContract(deployed).deployedValue(), sendValue, "fallback did not receive value");
  }

  function testDeployFallbackHandlesZeroValueForPayableFallback() public {
    bytes memory fallbackInit = valueReceiverInit(0);
    (LeafData memory gapLeaf, FallbackJson memory fallbackData) =
      buildManualValuePlan(constantInitCode(205), fallbackInit);

    vm.chainId(VALUE_PLAN_TARGET_CHAIN_ID);
    bytes32 saltLocal = keccak256("fallback-payable-zero-value");

    address deployed = create4.deployFallback(
      gapLeaf.prefix,
      gapLeaf.initCodeHash,
      copyProof(gapLeaf.proof),
      copyProof(fallbackData.proof),
      fallbackData.initCode,
      saltLocal
    );

    assertEq(ValueExpectingContract(deployed).deployedValue(), 0, "fallback should record zero value");
  }

  function testDeployFallbackRevertsWhenSendingValueToNonPayableFallback() public {
    bytes memory fallbackInit = nonPayableValueInitCode();
    (LeafData memory gapLeaf, FallbackJson memory fallbackData) =
      buildManualValuePlan(constantInitCode(206), fallbackInit);

    vm.chainId(VALUE_PLAN_TARGET_CHAIN_ID);
    bytes32 saltLocal = keccak256("fallback-nonpayable-value");

    vm.expectRevert();
    create4.deployFallback{ value: 1 wei }(
      gapLeaf.prefix,
      gapLeaf.initCodeHash,
      copyProof(gapLeaf.proof),
      copyProof(fallbackData.proof),
      fallbackData.initCode,
      saltLocal
    );
  }



  function runCliBuild(string memory specPath) internal returns (string memory) {
    string[] memory inputs = new string[](5);
    inputs[0] = "node";
    inputs[1] = cliScript;
    inputs[2] = "build";
    inputs[3] = "--input";
    inputs[4] = specPath;

    bytes memory output = vm.ffi(inputs);
    return string(output);
  }

  function runCliBuildExternal(string memory specPath) external returns (string memory) {
    return runCliBuild(specPath);
  }

  function runCliProof(string memory specPath, uint64 chainId) internal returns (string memory) {
    string[] memory inputs = new string[](7);
    inputs[0] = "node";
    inputs[1] = cliScript;
    inputs[2] = "proof";
    inputs[3] = "--input";
    inputs[4] = specPath;
    inputs[5] = "--chain";
    inputs[6] = uintToString(chainId);

    bytes memory output = vm.ffi(inputs);
    return string(output);
  }

  function runCliOrSkip(string memory specPath) internal returns (string memory) {
    try this.runCliBuildExternal(specPath) returns (string memory planJson) {
      return planJson;
    } catch {
      vm.assume(false);
      return "";
    }
  }

  function loadPlanFromJson(string memory planJson) internal {
    planRoot = planJson.readBytes32(".root");
    salt = planJson.readBytes32(".salt");

    (LeafData[] memory decodedLeaves, FallbackJson memory fallbackData) = decodePlanToMemory(planJson);

    delete leaves;
    for (uint256 i = 0; i < decodedLeaves.length; i++) {
      leaves.push(decodedLeaves[i]);
    }

    fallbackInitCode = fallbackData.initCode;
    fallbackProof = fallbackData.proof;
    fallbackPrefix = fallbackData.prefix;
    fallbackInitHash = fallbackData.initCodeHash;
  }

  function decodePlanToMemory(string memory planJson)
    internal
    view
    returns (LeafData[] memory decodedLeaves, FallbackJson memory fallbackDecoded)
  {
    uint256 leafCount = countLeaves(planJson);
    decodedLeaves = new LeafData[](leafCount);
    for (uint256 i = 0; i < leafCount; i++) {
      string memory base = leafPointer(i);
      uint64 chainId = parseChainIdString(planJson.readString(string.concat(base, ".chainId")));
      uint64 nextChainId = parseChainIdString(planJson.readString(string.concat(base, ".nextChainId")));
      bytes memory initCode = planJson.readBytes(string.concat(base, ".initCode"));
      bytes32 initCodeHash = planJson.readBytes32(string.concat(base, ".initCodeHash"));
      bytes32 prefix = planJson.readBytes32(string.concat(base, ".prefix"));
      bytes32[] memory proof = abi.decode(planJson.parseRaw(string.concat(base, ".proof")), (bytes32[]));

      decodedLeaves[i] = LeafData({
        chainId: chainId,
        nextChainId: nextChainId,
        initCode: initCode,
        initCodeHash: initCodeHash,
        prefix: prefix,
        proof: proof
      });
    }

    string memory fallbackBase = ".fallback";
    fallbackDecoded = FallbackJson({
      chainId: parseChainIdString(planJson.readString(string.concat(fallbackBase, ".chainId"))),
      initCode: planJson.readBytes(string.concat(fallbackBase, ".initCode")),
      initCodeHash: planJson.readBytes32(string.concat(fallbackBase, ".initCodeHash")),
      leafHash: planJson.readBytes32(string.concat(fallbackBase, ".leafHash")),
      nextChainId: parseChainIdString(planJson.readString(string.concat(fallbackBase, ".nextChainId"))),
      prefix: planJson.readBytes32(string.concat(fallbackBase, ".prefix")),
      proof: abi.decode(planJson.parseRaw(string.concat(fallbackBase, ".proof")), (bytes32[]))
    });
  }

  function prepareFallbackCase() internal {
    LeafData memory gapLeaf = findLeaf(GAP_CHAIN_ID);
    fallbackCase.targetChainId = GAP_TARGET_CHAIN_ID;
    fallbackCase.gapLeafPrefix = gapLeaf.prefix;
    fallbackCase.gapLeafHash = gapLeaf.initCodeHash;
    copyProofToStorage(gapLeaf.proof, fallbackCase.gapProof);
    copyStorageProof(fallbackProof, fallbackCase.fallbackProof);
  }

  function buildFallbackCaseFromLeaf(LeafData memory gapLeaf, uint64 targetChainId)
    internal
    view
    returns (FallbackCase memory caseData)
  {
    caseData.targetChainId = targetChainId;
    caseData.gapLeafPrefix = gapLeaf.prefix;
    caseData.gapLeafHash = gapLeaf.initCodeHash;
    caseData.gapProof = copyProof(gapLeaf.proof);
    caseData.fallbackProof = copyStorageProofToMemory(fallbackProof);
  }

  function readWord(address target) internal returns (uint256 value) {
    (bool success, bytes memory data) = target.call(new bytes(0));
    require(success, "call failed");
    require(data.length >= 32, "invalid return length");
    value = abi.decode(data, (uint256));
  }

  function copyProof(bytes32[] memory source) internal pure returns (bytes32[] memory proof) {
    proof = new bytes32[](source.length);
    for (uint256 i = 0; i < source.length; i++) {
      proof[i] = source[i];
    }
  }

  function findLeaf(uint64 chainId) internal view returns (LeafData memory) {
    for (uint256 i = 0; i < leaves.length; i++) {
      if (leaves[i].chainId == chainId) {
        return leaves[i];
      }
    }
    revert("leaf not found");
  }

  function findLeafOptional(LeafData[] memory data, uint64 chainId)
    internal
    pure
    returns (bool found, LeafData memory leaf)
  {
    for (uint256 i = 0; i < data.length; i++) {
      if (data[i].chainId == chainId) {
        return (true, data[i]);
      }
    }
  }

  function writeSpecToCache(string memory contents) internal returns (string memory path) {
    bytes32 specHash = keccak256(bytes(contents));
    string memory base = string.concat(
      vm.projectRoot(),
      "/cache/cli-spec-",
      bytes32ToHex(specHash),
      "-",
      uintToString(specNonce++),
      ".json"
    );
    vm.writeFile(base, contents);
    return base;
  }

  function buildSpecJson(
    uint64 chainIdA,
    bytes memory initCodeA,
    uint64 chainIdB,
    bytes memory initCodeB,
    bytes memory fallbackInit,
    bytes32 planSalt
  ) internal pure returns (string memory) {
    ChainInput[] memory chains = new ChainInput[](2);
    chains[0] = ChainInput({ chainId: chainIdA, initCode: initCodeA, label: "fuzz-0" });
    chains[1] = ChainInput({ chainId: chainIdB, initCode: initCodeB, label: "fuzz-1" });
    return serializePlanSpec(chains, fallbackInit, planSalt);
  }

  function serializePlanSpec(ChainInput[] memory chains, bytes memory fallbackInit, bytes32 planSalt)
    internal
    pure
    returns (string memory)
  {
    bytes memory entries;
    for (uint256 i = 0; i < chains.length; i++) {
      if (i != 0) {
        entries = abi.encodePacked(entries, ",");
      }
      entries = abi.encodePacked(entries, chainSpec(chains[i]));
    }

    return string(
      abi.encodePacked(
        "{",
        "\"salt\":\"", bytes32ToHex(planSalt), "\",",
        "\"chains\":[",
        entries,
        "],",
        "\"fallbackInitCode\":\"",
        bytesToHex(fallbackInit),
        "\"}"
      )
    );
  }

  function chainSpec(ChainInput memory input) internal pure returns (string memory) {
    return string(
      abi.encodePacked(
        "{",
        "\"chainId\":\"",
        uintToString(uint256(input.chainId)),
        "\",\"label\":\"",
        input.label,
        "\",\"initCode\":\"",
        bytesToHex(input.initCode),
        "\"}"
      )
    );
  }

  function valueReceiverInit(uint256 expectedValue) internal pure returns (bytes memory) {
    return abi.encodePacked(type(ValueExpectingContract).creationCode, abi.encode(expectedValue));
  }

  function nonPayableValueInitCode() internal pure returns (bytes memory) {
    return type(NonPayableValueContract).creationCode;
  }

  function constantInitCode(uint8 value) internal pure returns (bytes memory) {
    bytes memory runtime = abi.encodePacked(
      hex"60",
      bytes1(value),
      hex"60005260206000f3"
    );
    bytes1 runtimeLength = bytes1(uint8(runtime.length));
    return abi.encodePacked(
      hex"60",
      runtimeLength,
      hex"600c60003960",
      runtimeLength,
      hex"6000f3",
      runtime
    );
  }

  function bytesToHex(bytes memory data) internal pure returns (string memory) {
    bytes memory buffer = new bytes(2 + data.length * 2);
    buffer[0] = "0";
    buffer[1] = "x";
    for (uint256 i = 0; i < data.length; i++) {
      buffer[2 + i * 2] = HEX_SYMBOLS[uint8(data[i] >> 4)];
      buffer[3 + i * 2] = HEX_SYMBOLS[uint8(data[i] & 0x0f)];
    }
    return string(buffer);
  }

  function bytes32ToHex(bytes32 data) internal pure returns (string memory) {
    return bytesToHex(abi.encodePacked(data));
  }

  function copyProofToStorage(bytes32[] memory source, bytes32[] storage target) internal {
    while (target.length > 0) {
      target.pop();
    }
    for (uint256 i = 0; i < source.length; i++) {
      target.push(source[i]);
    }
  }

  function copyStorageProof(bytes32[] storage source, bytes32[] storage target) internal {
    while (target.length > 0) {
      target.pop();
    }
    for (uint256 i = 0; i < source.length; i++) {
      target.push(source[i]);
    }
  }

  function copyStorageProofToMemory(bytes32[] storage source) internal view returns (bytes32[] memory proof) {
    proof = new bytes32[](source.length);
    for (uint256 i = 0; i < source.length; i++) {
      proof[i] = source[i];
    }
  }

  function uintToString(uint256 value) internal pure returns (string memory) {
    if (value == 0) {
      return "0";
    }
    uint256 temp = value;
    uint256 digits;
    while (temp != 0) {
      digits++;
      temp /= 10;
    }
    bytes memory buffer = new bytes(digits);
    while (value != 0) {
      digits--;
      buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
      value /= 10;
    }
    return string(buffer);
  }

  function parseChainIdString(string memory value) internal pure returns (uint64) {
    bytes memory data = bytes(value);
    require(data.length > 0, "chain id string empty");
    uint256 base = 10;
    uint256 start = 0;
    if (data.length >= 2 && data[0] == "0" && (data[1] == "x" || data[1] == "X")) {
      base = 16;
      start = 2;
    }
    require(data.length > start, "chain id missing digits");

    uint256 result = 0;
    for (uint256 i = start; i < data.length; i++) {
      uint8 charCode = uint8(data[i]);
      uint8 digit;
      if (charCode >= 48 && charCode <= 57) {
        digit = charCode - 48;
      } else if (base == 16 && charCode >= 97 && charCode <= 102) {
        digit = 10 + charCode - 97;
      } else if (base == 16 && charCode >= 65 && charCode <= 70) {
        digit = 10 + charCode - 65;
      } else {
        revert("invalid chain id character");
      }
      result = result * base + digit;
      require(result <= MAX_CHAIN_ID, "chain id overflow");
    }
    return uint64(result);
  }

  function leafPointer(uint256 index) internal pure returns (string memory) {
    return string.concat(".leaves[", uintToString(index), "]");
  }

  function countLeaves(string memory planJson) internal view returns (uint256 count) {
    while (planJson.keyExists(string.concat(leafPointer(count), ".chainId"))) {
      unchecked {
        count++;
      }
    }
  }

  function generatePlanSpec(uint256 seed, uint256 leafCount) internal pure returns (string memory) {
    require(leafCount >= 2, "leaf count too small");

    ChainInput[] memory chains = new ChainInput[](leafCount);

    uint64 step = 17;
    uint64 maxBase = MAX_CHAIN_ID - uint64(leafCount) * step;
    if (maxBase == 0) {
      maxBase = 1;
    }
    bytes32 randomness = keccak256(abi.encodePacked(seed));
    uint64 base = uint64(uint256(randomness) % maxBase) + 1;

    for (uint256 i = 0; i < leafCount; i++) {
      randomness = keccak256(abi.encodePacked(randomness, i));
      uint64 chainId = base + uint64(i) * step;
      uint8 value = uint8(uint256(randomness));
      chains[i] = ChainInput({
        chainId: chainId,
        initCode: constantInitCode(value),
        label: labelForIndex(i)
      });
    }

    randomness = keccak256(abi.encodePacked(randomness, "fallback"));
    bytes memory fallbackInit = constantInitCode(uint8(uint256(randomness)));
    bytes32 planSalt = keccak256(abi.encodePacked(randomness, seed, leafCount));
    return serializePlanSpec(chains, fallbackInit, planSalt);
  }

  function labelForIndex(uint256 index) internal pure returns (string memory) {
    return string(abi.encodePacked("leaf-", uintToString(index)));
  }

  function computeRootFromLeaf(LeafData memory leaf) internal pure returns (bytes32 node) {
    node = scratchPacked(leaf.prefix, leaf.initCodeHash);
    for (uint256 i = 0; i < leaf.proof.length; i++) {
      node = commutative(node, leaf.proof[i]);
    }
  }

  function computeFallbackRoot(FallbackJson memory fallbackData) internal pure returns (bytes32 node) {
    node = scratchPacked(fallbackData.prefix, fallbackData.initCodeHash);
    for (uint256 i = 0; i < fallbackData.proof.length; i++) {
      node = commutative(node, fallbackData.proof[i]);
    }
  }

  function computeCreate3AddressFromRoot(address deployer, bytes32 node, bytes32 planSalt)
    internal
    pure
    returns (address)
  {
    bytes32 createSalt = scratchPacked(node, planSalt);
    return computeCreate3Address(deployer, createSalt);
  }

  function computeCreate3ProxyAddress(address deployer, bytes32 createSalt) internal pure returns (address) {
    bytes32 proxy = keccak256(
      abi.encodePacked(
        hex"ff",
        deployer,
        createSalt,
        KECCAK256_PROXY_CHILD_BYTECODE
      )
    );
    return address(uint160(uint256(proxy)));
  }

  function computeCreate3Address(address deployer, bytes32 createSalt) internal pure returns (address) {
    address proxyAddr = computeCreate3ProxyAddress(deployer, createSalt);
    return address(
      uint160(
        uint256(
          keccak256(
            abi.encodePacked(
              hex"d694",
              proxyAddr,
              hex"01"
            )
          )
        )
      )
    );
  }

  function scratchPacked(bytes32 a, bytes32 b) internal pure returns (bytes32 c) {
    assembly {
      mstore(0x00, a)
      mstore(0x20, b)
      c := keccak256(0x00, 0x40)
    }
  }

  function commutative(bytes32 a, bytes32 b) internal pure returns (bytes32) {
    return a < b ? scratchPacked(a, b) : scratchPacked(b, a);
  }

  function computeGapTargetExternal(uint64 chainId, uint64 nextChainId, uint64 entropy) external pure returns (uint64) {
    return computeGapTarget(chainId, nextChainId, entropy);
  }

  function assertPrefixDecodes(bytes32 prefix, uint64 expectedChainId, uint64 expectedNext, uint8 expectedFallbackFlag)
    internal
    view
  {
    (uint64 decodedChain, uint64 decodedNext, uint8 decodedFlag) = create4Harness.decodeLeafPrefixExternal(prefix);
    assertEq(decodedChain, expectedChainId, "decoded chain mismatch");
    assertEq(decodedNext, expectedNext, "decoded next mismatch");
    assertEq(decodedFlag, expectedFallbackFlag, "decoded fallback flag mismatch");
  }

  function buildManualValuePlan(bytes memory leafInitCode, bytes memory fallbackPlanInit)
    internal
    view
    returns (LeafData memory leaf, FallbackJson memory fallbackData)
  {
    bytes32 leafPrefix = create4Harness.packLeafPrefixExternal(VALUE_PLAN_CHAIN_ID, VALUE_PLAN_NEXT_CHAIN_ID, 0);
    bytes32 fallbackPrefixLocal = create4Harness.packLeafPrefixExternal(0, 0, 1);

    bytes32 leafInitHash = keccak256(leafInitCode);
    bytes32 fallbackPlanHash = keccak256(fallbackPlanInit);
    bytes32 leafNode = scratchPacked(leafPrefix, leafInitHash);
    bytes32 fallbackNode = scratchPacked(fallbackPrefixLocal, fallbackPlanHash);

    bytes32[] memory leafProof = new bytes32[](1);
    leafProof[0] = fallbackNode;

    bytes32[] memory fallbackProofLocal = new bytes32[](1);
    fallbackProofLocal[0] = leafNode;

    leaf = LeafData({
      chainId: VALUE_PLAN_CHAIN_ID,
      nextChainId: VALUE_PLAN_NEXT_CHAIN_ID,
      initCode: leafInitCode,
      initCodeHash: leafInitHash,
      prefix: leafPrefix,
      proof: leafProof
    });

    fallbackData = FallbackJson({
      chainId: 0,
      initCode: fallbackPlanInit,
      initCodeHash: fallbackPlanHash,
      leafHash: fallbackNode,
      nextChainId: 0,
      prefix: fallbackPrefixLocal,
      proof: fallbackProofLocal
    });
  }

  function buildManualHighPlan() internal view returns (ManualHighPlan memory plan) {
    plan.chainIdA = type(uint64).max - 1;
    plan.chainIdB = type(uint64).max;
    bytes memory initCodeA = constantInitCode(5);
    bytes memory initCodeB = constantInitCode(6);
    bytes memory fallbackCode = constantInitCode(7);

    plan.prefixA = create4Harness.packLeafPrefixExternal(plan.chainIdA, plan.chainIdB, 0);
    plan.prefixB = create4Harness.packLeafPrefixExternal(plan.chainIdB, plan.chainIdA, 0);
    plan.fallbackPrefix = create4Harness.packLeafPrefixExternal(0, 0, 1);

    bytes32 initHashA = keccak256(initCodeA);
    bytes32 initHashB = keccak256(initCodeB);
    bytes32 fallbackHashLocal = keccak256(fallbackCode);

    bytes32 leafHashA = scratchPacked(plan.prefixA, initHashA);
    bytes32 leafHashB = scratchPacked(plan.prefixB, initHashB);
    bytes32 fallbackLeafHash = scratchPacked(plan.fallbackPrefix, fallbackHashLocal);

    bytes32 parentAB = commutative(leafHashA, leafHashB);
    bytes32 parentFallback = commutative(fallbackLeafHash, fallbackLeafHash);
    plan.expectedRoot = commutative(parentAB, parentFallback);

    plan.leaves = new LeafData[](2);
    plan.leaves[0] = LeafData({
      chainId: plan.chainIdA,
      nextChainId: plan.chainIdB,
      initCode: initCodeA,
      initCodeHash: initHashA,
      prefix: plan.prefixA,
      proof: new bytes32[](2)
    });
    plan.leaves[0].proof[0] = leafHashB;
    plan.leaves[0].proof[1] = parentFallback;

    plan.leaves[1] = LeafData({
      chainId: plan.chainIdB,
      nextChainId: plan.chainIdA,
      initCode: initCodeB,
      initCodeHash: initHashB,
      prefix: plan.prefixB,
      proof: new bytes32[](2)
    });
    plan.leaves[1].proof[0] = leafHashA;
    plan.leaves[1].proof[1] = parentFallback;

    plan.fallbackData = FallbackJson({
      chainId: 0,
      initCode: fallbackCode,
      initCodeHash: fallbackHashLocal,
      leafHash: fallbackLeafHash,
      nextChainId: 0,
      prefix: plan.fallbackPrefix,
      proof: new bytes32[](2)
    });
    plan.fallbackData.proof[0] = fallbackLeafHash;
    plan.fallbackData.proof[1] = parentAB;
  }

  function buildSingleLeafPlan()
    internal
    returns (LeafData memory singleLeaf, FallbackJson memory fallbackData, bytes32 saltLocal, bytes32 planRootLocal)
  {
    ChainInput[] memory chains = new ChainInput[](1);
    chains[0] = ChainInput({ chainId: 77, initCode: constantInitCode(77), label: "single-leaf" });
    bytes memory fallbackCode = constantInitCode(207);
    bytes32 planSaltLocal = keccak256("single-leaf-plan");

    string memory planJson = runCliBuild(writeSpecToCache(serializePlanSpec(chains, fallbackCode, planSaltLocal)));
    planRootLocal = planJson.readBytes32(".root");
    saltLocal = planJson.readBytes32(".salt");
    (LeafData[] memory planLeaves, FallbackJson memory fallbackDataLocal) = decodePlanToMemory(planJson);
    require(planLeaves.length == 1, "expected single leaf plan");
    singleLeaf = planLeaves[0];
    fallbackData = fallbackDataLocal;
  }

  function computeGapTarget(uint64 chainId, uint64 nextChainId, uint64 entropy) internal pure returns (uint64) {
    if (chainId == nextChainId) {
      // Single-entry plan: pick any chain id other than the leaf's chain id.
      uint256 offset = uint256(entropy) % uint256(type(uint64).max);
      return uint64(uint256(chainId) + 1 + offset);
    }
    if (chainId < nextChainId) {
      uint256 range = uint256(nextChainId) - uint256(chainId) - 1;
      require(range > 0, "no available gap");
      return chainId + 1 + uint64(uint256(entropy) % range);
    } else {
      uint256 highRange = type(uint64).max - uint256(chainId);
      uint256 lowRange = uint256(nextChainId);
      uint256 totalRange = highRange + lowRange;
      require(totalRange > 0, "no available wrap gap");

      uint256 pick = uint256(entropy) % totalRange;
      if (pick < highRange) {
        return chainId + 1 + uint64(pick);
      }
      return uint64(pick - highRange);
    }
  }

  function decodeConstant(bytes memory initCode) internal pure returns (uint8) {
    require(initCode.length >= 10, "invalid init code");
    uint256 runtimeStart = initCode.length - 10;
    require(initCode[runtimeStart] == 0x60, "invalid runtime prefix");
    return uint8(initCode[runtimeStart + 1]);
  }

  function clearAddress(address target) internal {
    vm.etch(target, hex"");
    vm.resetNonce(target);
  }
}
