# CRE Price Snapshot Workflow

A **Chainlink Runtime Environment (CRE)** workflow that:

1. Accepts an HTTP `POST /snapshot` with body `{ "token": "ETH" }`
2. Reads the current USD price from a **Chainlink Data Feed on Sepolia** via **EVM Read**
3. Writes the result on-chain via **EVM Write** to a deployed `PriceSnapshot` contract

---

## Architecture

```
HTTP POST /snapshot
  { "token": "ETH" }
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  CRE Workflow  (price-snapshot.ts)                       │
│                                                          │
│  Step 1: parse_request   – validate token, get feed addr │
│  Step 2: read_price      – EVM Read → latestRoundData()  │
│                             Chainlink ETH/USD on Sepolia  │
│  Step 3: read_latest_block – EVM Read (reference block)  │
│  Step 4: compute_block   – derive blockNumber / updatedAt│
│  Step 5: write_snapshot  – EVM Write → snapshot()        │
│  Step 6: respond         – HTTP 200 JSON response        │
└─────────────────────────────────────────────────────────┘
        │                          │
        │ EVM Read                 │ EVM Write
        ▼                          ▼
Chainlink ETH/USD Feed    PriceSnapshot.sol (Sepolia)
0x694AA1769357215DE4FAC   Your deployed contract
```

---

## Supported Tokens

| Token | Chainlink Feed (Sepolia)                     |
|-------|----------------------------------------------|
| ETH   | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
| BTC   | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` |
| LINK  | `0xc59E3633BAAC79493d908e63626716e204A45EdF` |
| USDC  | `0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E` |

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js     | ≥ 18    |
| `cre` CLI   | latest  |
| Sepolia ETH | ~0.05 ETH for deploy + gas |

Install the CRE CLI:

```bash
npm install -g @chainlink/cre-cli
```

---

## Project Structure

```
cre-price-snapshot/
├── contracts/
│   ├── PriceSnapshot.sol           # Main contract (ISnapshot interface)
│   └── ChainlinkBlockResolver.sol  # Optional helper for block number resolution
├── scripts/
│   └── deploy.ts                   # Hardhat deploy script
├── workflow/
│   ├── price-snapshot.ts           # CRE workflow (TypeScript)
│   ├── workflow.yaml               # CRE manifest
│   └── secrets.yaml.example        # Template – copy to secrets.yaml
├── .env.example                    # Template – copy to .env
├── hardhat.config.ts
├── package.json
└── tsconfig.json
```

---

## Step-by-Step Setup

### 1. Clone & install dependencies

```bash
git clone https://github.com/YOUR_USERNAME/cre-price-snapshot.git
cd cre-price-snapshot
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
SEPOLIA_RPC_URL=https://rpc.sepolia.org
FORWARDER_ADDRESS=0xCRE_FORWARDER_ADDRESS_ON_SEPOLIA
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY   # optional, for verification
```

> **Finding the CRE Forwarder address:**  
> Check the [Chainlink CRE documentation](https://docs.chain.link/chainlink-automation/overview/supported-networks) for the current Sepolia forwarder address.  
> It is the address that the CRE runtime uses to call `onlyForwarder`-gated functions in your contract.

> **Getting Sepolia ETH:**  
> Use the [Sepolia faucet](https://sepoliafaucet.com/) or [Alchemy faucet](https://sepoliafaucet.com/).

### 3. Compile the contracts

```bash
npm run compile
```

Expected output:
```
Compiled 2 Solidity files successfully
```

### 4. Deploy PriceSnapshot to Sepolia

```bash
npm run deploy
```

Expected output:
```
Deploying with account: 0xYOUR_DEPLOYER_ADDRESS
Account balance: 0.1 ETH
Forwarder address: 0xCRE_FORWARDER_ADDRESS

✅ PriceSnapshot deployed to: 0xYOUR_CONTRACT_ADDRESS

Add this to your .env / secrets.yaml:
  CONTRACT_ADDRESS=0xYOUR_CONTRACT_ADDRESS
```

### 5. (Optional) Verify on Etherscan

```bash
npx hardhat verify --network sepolia 0xYOUR_CONTRACT_ADDRESS "0xCRE_FORWARDER_ADDRESS"
```

### 6. Configure CRE secrets

```bash
cp workflow/secrets.yaml.example workflow/secrets.yaml
```

Edit `workflow/secrets.yaml`:

```yaml
secrets:
  SIGNING_KEY:       "0xYOUR_PRIVATE_KEY"
  CONTRACT_ADDRESS:  "0xYOUR_CONTRACT_ADDRESS"
```

> ⚠️ `secrets.yaml` is in `.gitignore` and must **never** be committed.

### 7. Run the workflow simulation

```bash
cre workflow simulate workflow --broadcast
```

This will:
- Send a default `POST /snapshot` trigger with body `{ "token": "ETH" }`
- Execute EVM Read against the Chainlink ETH/USD Data Feed on Sepolia
- Execute EVM Write, broadcasting the `snapshot()` transaction to Sepolia
- Print the transaction hash and Etherscan link

#### Custom token:

```bash
cre workflow simulate workflow --broadcast --trigger-body '{"token":"BTC"}'
```

---

## Example Response

```json
{
  "token": "ETH",
  "priceUsd": "3412.85",
  "priceRaw": "341285000000",
  "blockNumber": "1718123456",
  "updatedAt": "1718123456",
  "txHash": "0xabc123...",
  "explorer": "https://sepolia.etherscan.io/tx/0xabc123..."
}
```

---

## Smart Contract Details

### `PriceSnapshot.sol`

```solidity
interface ISnapshot {
    struct Record {
        string  token;        // e.g. "ETH"
        uint256 price;        // Chainlink answer scaled ×1e8
        uint256 blockNumber;  // updatedAt from latestRoundData()
        uint256 timestamp;    // updatedAt Unix timestamp
    }
}
```

**Key features:**

- Implements `ISnapshot` interface with `Record` struct
- `onlyForwarder` modifier — only the CRE forwarder address can call `snapshot()`
- Stores `latestRecord[token]` and full `history[token][]`
- Emits `SnapshotRecorded` event on every write
- View helpers: `getLatestRecord()`, `getHistoricalRecord()`, `getHistoryLength()`

### Forwarder Check

```solidity
modifier onlyForwarder() {
    if (msg.sender != forwarder) revert NotForwarder(msg.sender);
    _;
}
```

The `forwarder` address is set **immutably** in the constructor and cannot be changed, preventing unauthorized writes.

---

## On Block Number Storage

The Chainlink `AggregatorV3Interface` exposes `updatedAt` (the `block.timestamp` of the transaction that last updated the feed), but does **not** expose `block.number` directly via its standard interface.

This workflow stores `updatedAt` (the block's Unix timestamp) in the `blockNumber` field, which is the canonical on-chain value you can derive from `latestRoundData()` without a custom contract.

If you need the actual block number, deploy `contracts/ChainlinkBlockResolver.sol` and add a step that calls `currentContext()` to get the current block number, then estimates the target block using:

```
targetBlock ≈ currentBlock - round((currentTimestamp - updatedAt) / 12)
```

---

## Security

| File | Committed? |
|------|-----------|
| `.env` | ❌ Never |
| `workflow/secrets.yaml` | ❌ Never |
| `.env.example` | ✅ Yes (template only) |
| `workflow/secrets.yaml.example` | ✅ Yes (template only) |

---

## Chainlink Data Feed References

- [Data Feed Addresses — Sepolia](https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1&search=sepolia)
- [AggregatorV3Interface](https://docs.chain.link/data-feeds/api-reference#aggregatorv3interface)
- [CRE Documentation](https://docs.chain.link/chainlink-automation)

---

## License

MIT
