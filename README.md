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
<img width="1892" height="690" alt="image" src="https://github.com/user-attachments/assets/bab11b69-d75c-4656-a082-37dc1c93eb7f" />


---

## License

MIT
