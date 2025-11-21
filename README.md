# CREATE4 - EVM Universal Binary Deployer

CREATE4 is an ethereum universal deployer that lets you trustlessly deploy, to the same address, contracts that have different binaries on each chain. It lets you keep one canonical address while customizing the bytecode per network.

## Abstract

There are hundreds of EVM-compatible chains. CREATE2 and CREATE3-style universal deployers are commonly used to deploy the same bytecode to a fixed address across networks, which is great when you want identical behavior everywhere.

The catch is that existing patterns require all deployments to share the exact same bytecode, so you end up targeting the lowest common denominator of the EVM versions in use.

CREATE4 drops that constraint. It uses CREATE3 to decouple the address from the bytecode, and a factory that re-couples the address to a “deployment plan”: a Merkle tree of per-chain init codes plus a global fallback. The plan is committed to on-chain, and the same plan can be deployed consistently from any chain.

### Demo

The following contract was deployed using CREATE4 as an asymmetric contract; it is an ERC721 on Ethereum, an ERC20 on Polygon, and a simpler contract on every other network.

| Variant   | Address                                      | Network     | Explorer Link                                                    |
|-----------|----------------------------------------------|-------------|------------------------------------------------------------------|
| ERC721    | 0x510702321CfC9C7EdCcA4323eD222ce268CE80D5  | Ethereum    | [Etherscan](https://etherscan.io/address/0x510702321CfC9C7EdCcA4323eD222ce268CE80D5) |
| ERC20     | 0x510702321CfC9C7EdCcA4323eD222ce268CE80D5  | Polygon     | [Polygonscan](https://polygonscan.com/address/0x510702321CfC9C7EdCcA4323eD222ce268CE80D5) |
| Fallback  | 0x510702321CfC9C7EdCcA4323eD222ce268CE80D5  | Optimism    | [Optimism Explorer](https://optimistic.etherscan.io/address/0x510702321CfC9C7EdCcA4323eD222ce268CE80D5) |
| Fallback  | 0x510702321CfC9C7EdCcA4323eD222ce268CE80D5  | Arbitrum    | [Arbiscan](https://arbiscan.io/address/0x510702321CfC9C7EdCcA4323eD222ce268CE80D5) |

### Deployed factory

| Chain           | Network Type | Contract                                   | Explorer                                                                 |
|-----------------|-------------|---------------------------------------------|--------------------------------------------------------------------------|
| Ethereum Mainnet| Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Etherscan](https://etherscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
| Polygon PoS     | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Polygonscan](https://polygonscan.com/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
| Arbitrum One    | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Arbiscan](https://arbiscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
| Optimism        | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [OP Mainnet Explorer](https://optimistic.etherscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
| Base            | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [BaseScan](https://basescan.org/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |

<details>
  <summary>Other networks</summary>

  #### Mainnets

  | Chain              | Network Type | Contract                                   | Explorer                                                                 |
  |--------------------|-------------|---------------------------------------------|--------------------------------------------------------------------------|
  | BNB Smart Chain    | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [BscScan](https://bscscan.com/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Gnosis Chain       | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [GnosisScan](https://gnosisscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Polygon zkEVM      | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [OKLink Polygon zkEVM](https://www.oklink.com/polygon-zkevm/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Moonbeam           | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Moonscan](https://moonscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Soneium            | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Soneium Blockscout](https://soneium.blockscout.com/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | B3                 | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [B3 Explorer](https://explorer.b3.fun/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Monad              | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Monad MonVision](https://mainnet-beta.monvision.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Immutable zkEVM    | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Immutable Explorer](https://explorer.immutable.com/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | HOMEVERSE          | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [HOMEVERSE Explorer](https://explorer.oasys.homeverse.games/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | ApeChain           | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Apescan](https://apescan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Arbitrum Nova      | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Nova Arbiscan](https://nova.arbiscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Etherlink          | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Etherlink Explorer](https://explorer.etherlink.com/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Avalanche C-Chain  | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Snowtrace](https://snowtrace.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Somnia             | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Somnia Explorer](https://explorer.somnia.network/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Blast              | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Blastscan](https://blastscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Xai                | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Xaiscan](https://xaiscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | SEI EVM            | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Seiscan](https://seiscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Katana             | Mainnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [KatanaScan](https://katanascan.com/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |

  #### Testnets

  | Chain                 | Network Type | Contract                                   | Explorer                                                                 |
  |-----------------------|-------------|---------------------------------------------|--------------------------------------------------------------------------|
  | B3 Sepolia            | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [B3 Sepolia Explorer](https://sepolia.explorer.b3.fun/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Monad Testnet         | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [MonadScan Testnet](https://testnet.monadscan.com/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Immutable zkEVM Testnet | Testnet   | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Immutable Testnet Explorer](https://explorer.testnet.immutable.com/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | HOMEVERSE Testnet     | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [HOMEVERSE Testnet Explorer](https://explorer.testnet.oasys.homeverse.games/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Avalanche Fuji        | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Snowtrace Fuji](https://testnet.snowtrace.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Somnia Testnet        | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Somnia Shannon Explorer](https://shannon-explorer.somnia.network/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Polygon Amoy          | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Amoy Polygonscan](https://amoy.polygonscan.com/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Base Sepolia          | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Base Sepolia Scan](https://sepolia.basescan.org/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Etherlink Testnet     | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Etherlink Testnet Explorer](https://testnet.explorer.etherlink.com/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Arbitrum Sepolia      | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Arbitrum Sepolia Arbiscan](https://sepolia.arbiscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Ethereum Sepolia      | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Sepolia Etherscan](https://sepolia.etherscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Optimism Sepolia      | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [OP Sepolia Explorer](https://sepolia-optimism.etherscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Toy Testnet           | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Toy Chain Testnet Explorer](https://toy-chain-testnet.explorer.caldera.xyz/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Blast Sepolia         | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Blastscan Sepolia](https://sepolia.blastscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Xai Testnet v2        | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Xaiscan Sepolia](https://sepolia.xaiscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Incentiv Testnet v2   | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Incentiv Testnet Explorer](https://explorer-testnet.incentiv.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | SEI Testnet           | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [Seiscan Testnet](https://testnet.seiscan.io/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |
  | Arc Testnet           | Testnet     | `0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166` | [ArcScan Testnet](https://testnet.arcscan.app/address/0xC4C4C4Ae7EA494fdb246991b70c8E40f471c9166) |

</details>

### Deployment address

The deployment plan root is computed as a Merkle tree where:

- `leaf = keccak256(pack(chainId, nextChainId, isFallback) ++ keccak256(initCode))`
- `parent(a,b) = keccak256(min(a,b) ++ max(a,b))`

Given `root` and `userSalt`, the deployed address is derived as:

- `createSalt = keccak256(root ++ userSalt)`
- `proxy = keccak256(0xff ++ factory ++ createSalt ++ KECCAK256_PROXY_CHILD_BYTECODE)[12:]`
- `addr = keccak256(0xd694 ++ proxy ++ 0x01)[12:]`

Where:

- `KECCAK256_PROXY_CHILD_BYTECODE = keccak256(0x67363d3d37363d34f03d5260086018f3) = 0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f`.

### Gap semantics

Every non-fallback leaf defines a “gap” that determines whether the fallback bytecode can be deployed on the current chain. When `chainId < nextChainId`, the gap is the open interval `(chainId, nextChainId)` (exclusive on both ends). The final entry in the sorted plan wraps back to the smallest chain id, so when `chainId > nextChainId` the gap covers _two_ segments: any id strictly greater than `chainId` or strictly smaller than `nextChainId`. This wrap-around behavior makes sure all undefined chains can still deploy the fallback, even when they sit “past” the highest listed chain id. Plans with only one chain entry have `chainId == nextChainId`; their gap is interpreted as “any chain id other than this one”, so the fallback remains deployable everywhere else.

The CLI `view` command prints these gaps, and the JavaScript library exposes helpers (`isChainIdInGap` / `describeGapRange`) so downstream tooling can reason about wrap-around intervals without re-implementing the logic.

#### Features

- Deployment plan specifies what bytecode to deploy on each network
- Fallback bytecode for any network not specifically defined
- Lightweight and without clutter
- Supports any EVM-compatible chain that implements `CREATE2` and `CHAINID`
- Merkle proofs keep gas overhead low
- Constructors fully supported
- Standard contract init code (Etherscan-style verification supported)
- Deterministic address across chains for a given factory + plan root + user salt
- CLI to build plans, compute addresses, and export per-chain proofs
- Agnostic to tooling: works with Solidity, Yul, Huff, or any source that produces init code

#### Limitations

- More expensive than `CREATE`, `CREATE2` and `CREATE3`
- Requires off-chain tooling to construct the deployment plan and proofs
- Plan semantics are “garbage in, garbage out”: the contract does not verify that the tree is well-formed or non-malleable
- Changing the plan (e.g. new per-chain bytecode) requires a new plan root, and thus a new CREATE3 salt or a new factory/plan combo (address)


## Use cases

### Multiple EVM version targeting

New EVM versions keep adding opcodes like `PUSH0` (Shanghai) or `MCOPY` (Cancun) that let you implement the same logic more cheaply. Chains adopt these hard forks at different times, and some never do.

If you need one shared address today, you typically compile everything against the oldest EVM you care about. With CREATE4, you can ship a “best EVM per chain” version while using the fallback only where nothing better is available.

### L1 / L2 / L3 specific optimizations

Different networks meter gas differently. Some L1s make calldata cheap, some L2s make compute cheap, and so on.

CREATE4 lets you deploy variants of the same contract that are tuned to each chain’s gas model (while preserving the address), instead of compromising on a single “okay everywhere, great nowhere” implementation.

### Non-symmetric contracts

Sometimes you do not want identical behavior on every chain. For example, on a “parent” chain you might have the canonical ERC20, and on other chains you want a bridge representation or a wrapper with extra logic.

CREATE4 lets you keep one shared address while deploying non-symmetric implementations: same address, different behavior per chain, defined and committed to by the deployment plan.

## Usage

### CLI

The CLI works over JSON specs of the form:

```json
{
  "salt": "0x1111...1111",
  "chains": [
    { "chainId": 1, "label": "alpha", "initCode": "0x..." },
    { "chainId": 10, "label": "beta",  "initCode": "0x..." }
  ],
  "fallbackInitCode": "0x..."
}
```

Chain IDs in specs may be provided as numbers when they are within JavaScript’s safe integer range, but for the full
uint64 space you should quote them (decimal or `0x` strings both work). CLI and library outputs always return chain IDs
as decimal strings to avoid silent precision loss.

Build a plan (root + leaves + fallback):

```sh
CREATE4-plan build --input ./spec.json --pretty > ./plan.json
```

Compute the CREATE3 child address for a factory + plan:

```sh
CREATE4-plan address \
  --input ./spec.json \
  --factory 0x1111111111111111111111111111111111111111
```

Override the plan salt when computing the deployment:

```sh
CREATE4-plan address \
  --input ./spec.json \
  --factory 0x1111111111111111111111111111111111111111 \
  --salt 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Get the inclusion proof and leaf data for a specific chain:

```sh
CREATE4-plan proof \
  --input ./spec.json \
  --chain 10 \
  --pretty > ./proof-10.json
```

Human-readable view of the plan:

```sh
CREATE4-plan view --input ./spec.json
CREATE4-plan view --input ./spec.json --proofs   # also print Merkle proofs
```

Interactive editing workflow (no manual JSON editing needed):

```sh
# Create a new editable spec file
CREATE4-plan edit create --file deployment-plan.edit.json --name "My Plan"

# Add chains and fallback from build artifacts or inline bytecode
CREATE4-plan edit add --file deployment-plan.edit.json --chain 1  --code 0x...
CREATE4-plan edit add --file deployment-plan.edit.json --chain 10 --code-file ./MyContract.json
CREATE4-plan edit add --file deployment-plan.edit.json --fallback --code 0x...

# Inspect the editable plan
CREATE4-plan edit view --file deployment-plan.edit.json

# Build a finalized plan from the editable spec
CREATE4-plan build --input deployment-plan.edit.json --pretty > plan.json
```

### Library (Node.js)

Install in your project:

```sh
npm install @0xsequence/CREATE4
```

Basic plan build + deployment address:

```js
const {
  buildPlanFromSpec,
  computePlanDeployment,
  getChainProof,
  computeCreate3Address,
  deriveDeploymentSalt,
  isChainIdInGap,
  describeGapRange,
} = require('@0xsequence/CREATE4');

const spec = {
  salt: '0x1111111111111111111111111111111111111111111111111111111111111111',
  chains: [
    { chainId: 1,  label: 'mainnet',  initCode: '0x...' },
    { chainId: 10, label: 'optimism', initCode: '0x...' },
  ],
  fallbackInitCode: '0x...',
};
// chainId values can also be decimal/hex strings or BigInts; plan outputs always use decimal strings.

// Build the plan (same shape as CLI build output)
const plan = buildPlanFromSpec(spec);
// plan.root, plan.leaves[], plan.fallback, plan.salt

// Compute CREATE3 deployment details for a factory
const factory = '0x1111111111111111111111111111111111111111';
const deployment = computePlanDeployment(spec, factory);
// deployment.address       -> CREATE3 child address
// deployment.planRoot      -> plan.root
// deployment.salt          -> effective salt
// deployment.deploymentSalt-> keccak256(planRoot, salt)

// Derive the CREATE3 deployment salt directly (if needed)
const deploymentSalt = deriveDeploymentSalt(plan.root, plan.salt);
const sameAddress = computeCreate3Address(factory, deploymentSalt);
```

Get the proof and leaf data for a specific chain (to send on-chain to `CREATE4.deploy` or `deployFallback`):

```js
const proof = getChainProof(spec, 10);
/*
proof = {
  root,
  chainId,
  nextChainId,
  prefix,
  initCode,
  initCodeHash,
  leafHash,
  proof,    // bytes32[] as 0x-prefixed strings
  salt,
}
*/

// Inspecting gap coverage for the fallback
const canFallbackOn120 = isChainIdInGap(proof.chainId, proof.nextChainId, 120);
const gapSummary = describeGapRange(proof.chainId, proof.nextChainId);
console.log({ canFallbackOn120, gapSummary });
```

# License - MIT

```
MIT License

Copyright (c) 2025 Sequence Platforms Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
