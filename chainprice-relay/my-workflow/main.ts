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

type EvmConfig = {
  chainName: string
  feedAddress: string
  contractAddress: string
  token: string
}

type Config = {
  schedule: string
  evms: EvmConfig[]
}

const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
])

const onCronTrigger = (runtime: Runtime<Config>): string => {
  const evmConfig = runtime.config.evms[0]

  const {
    token,
    feedAddress,
    contractAddress,
    chainName,
  } = evmConfig

  runtime.log(`[price-snapshot] token=${token} feed=${feedAddress}`)

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: chainName,
  })

  if (!network) {
    throw new Error(`Network not found: ${chainName}`)
  }

  const evmClient = new EVMClient(network.chainSelector.selector)

  const readCallData = encodeFunctionData({
    abi: aggregatorAbi,
    functionName: "latestRoundData",
    args: [],
  })

  const contractCall = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: feedAddress as `0x${string}`,
        data: readCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  const decoded = decodeFunctionResult({
    abi: aggregatorAbi,
    functionName: "latestRoundData",
    data: bytesToHex(contractCall.data),
  }) as readonly [bigint, bigint, bigint, bigint, bigint]

  const [, answer, , updatedAt] = decoded

  if (answer <= 0n) {
    throw new Error(`Bad price from feed: ${answer}`)
  }

  const priceUsd = (Number(answer) / 1e8).toFixed(2)

  runtime.log(
    `[price-snapshot] ${token} = $${priceUsd} updatedAt=${updatedAt}`,
  )

  const encoded = encodeAbiParameters(
    parseAbiParameters("string,uint256,uint256,uint256"),
    [token, answer, updatedAt, updatedAt],
  )

  const report = runtime
    .report({
      encodedPayload: hexToBase64(encoded),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result()

  const writeReply = evmClient
    .writeReport(runtime, {
      receiver: contractAddress as `0x${string}`,
      report,
    })
    .result()

  runtime.log(
    `[price-snapshot] txStatus=${writeReply.txStatus} txHash=${writeReply.txHash ?? "n/a"}`,
  )

  return JSON.stringify({
    token,
    priceUsd,
    priceRaw: answer.toString(),
    updatedAt: updatedAt.toString(),
    txStatus: writeReply.txStatus,
    txHash: writeReply.txHash,
  })
}

const initWorkflow = async (config: Config) => {
  const cron = new CronCapability()

  return [
    handler(
      cron.trigger({ schedule: config.schedule }),
      onCronTrigger,
    ),
  ]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
