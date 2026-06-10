import {
  CronCapability,
  EVMClient,
  handler,
  Runner,
  getNetwork,
  encodeCallMsg,
  bytesToHex,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  type Runtime,
} from "@chainlink/cre-sdk"
import {
  encodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  parseAbiParameters,
  parseAbi,
  zeroAddress,
} from "viem"

// ─── Config type (matches config.staging.json) ───────────────────────────────
type EvmConfig = {
  chainName:        string
  feedAddress:      string
  contractAddress:  string
  gasLimit:         string
  token:            string
}

type Config = {
  schedule: string
  evms:     EvmConfig[]
}

// ─── ABI ─────────────────────────────────────────────────────────────────────
const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
])

// ─── Trigger handler ──────────────────────────────────────────────────────────
const onCronTrigger = (runtime: Runtime<Config>): string => {
  const evmConfig = runtime.config.evms[0]
  const { token, feedAddress, contractAddress, chainName, gasLimit } = evmConfig

  runtime.log(`[price-snapshot] token=${token} feed=${feedAddress}`)

  // Get network
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: chainName })
  if (!network) throw new Error(`Network not found: ${chainName}`)

  const evmClient = new EVMClient(network.chainSelector.selector)

  // ── EVM Read: latestRoundData() from Chainlink Data Feed ──────────────────
  const readCallData = encodeFunctionData({
    abi:          aggregatorAbi,
    functionName: "latestRoundData",
    args:         [],
  })

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to:   feedAddress as `0x${string}`,
        data: readCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const decoded = decodeFunctionResult({
    abi:          aggregatorAbi,
    functionName: "latestRoundData",
    data:         bytesToHex(contractCall.data),
  }) as readonly [bigint, bigint, bigint, bigint, bigint]

  const [, answer, , updatedAt] = decoded

  if (answer <= 0n) throw new Error(`Bad price from feed: ${answer}`)

  const priceUsd = (Number(answer) / 1e8).toFixed(2)
  runtime.log(`[price-snapshot] ${token} = $${priceUsd} updatedAt=${updatedAt}`)

  // ── EVM Write: snapshot(token, price, blockNumber, timestamp) ─────────────
  // ABI-encode the payload — matches snapshot(string,uint256,uint256,uint256)
  const encoded = encodeAbiParameters(
    parseAbiParameters("string, uint256, uint256, uint256"),
    [token, answer, updatedAt, updatedAt],
  )

  // Generate signed CRE report
  const reportReply = runtime
    .report({
      encodedPayload: hexToBase64(encoded),
      encoderName:    "evm",
      signingAlgo:    "ecdsa",
      hashingAlgo:    "keccak256",
    })
    .result()

  // Submit on-chain
  const writeReply = evmClient
    .writeReport(runtime, {
      receiver: contractAddress as `0x${string}`,
      report:   reportReply.report,
      gasLimit: BigInt(gasLimit),
    })
    .result()

  runtime.log(`[price-snapshot] txStatus=${writeReply.txStatus} txHash=${writeReply.txHash ?? "n/a"}`)

  return JSON.stringify({
    token,
    priceUsd,
    priceRaw:  answer.toString(),
    updatedAt: updatedAt.toString(),
    txStatus:  writeReply.txStatus,
    txHash:    writeReply.txHash,
  })
}

// ─── Workflow entry point — exact pattern from official docs ──────────────────
const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export default async function main() {
  const runner = new Runner(initWorkflow)
  await runner.run()
}