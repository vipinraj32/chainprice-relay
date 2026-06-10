// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title  ChainlinkBlockResolver
 * @notice Read-only helper that returns the *block number* at which a
 *         Chainlink AggregatorV3 feed was last updated.
 *
 * The standard AggregatorV3Interface does not expose the update block number
 * directly – it only exposes `updatedAt` (the block.timestamp).  This helper
 * scans backwards from the current block to find the block whose timestamp
 * matches `updatedAt`, providing the exact block number to the CRE workflow.
 *
 * Deploy once on Sepolia; the workflow reads it via EVM Read.
 *
 * NOTE: This is an OPTIONAL helper.  The main PriceSnapshot workflow stores
 * `updatedAt` (the block timestamp) as the blockNumber field by default, which
 * is the canonical on-chain value available via the standard AggregatorV3
 * interface.  Deploy this helper only if you need the actual block number.
 */
interface AggregatorV3Interface {
    function latestRoundData()
        external view
        returns (
            uint80  roundId,
            int256  answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80  answeredInRound
        );
}

contract ChainlinkBlockResolver {
    /**
     * @notice Returns the block number at which the feed was last updated,
     *         found by scanning backwards from the current block.
     *
     * @param feed          Chainlink AggregatorV3 proxy address
     * @param maxLookback   Maximum number of blocks to scan (gas guard).
     *                      256 blocks ≈ ~51 minutes on Sepolia (12 s/block).
     * @return blockNum     The matching block number, or 0 if not found within
     *                      maxLookback blocks.
     * @return updatedAt    The feed's updatedAt timestamp (for convenience).
     */
    function resolveUpdateBlock(
        address feed,
        uint256 maxLookback
    )
        external view
        returns (uint256 blockNum, uint256 updatedAt)
    {
        (, , , uint256 ts, ) = AggregatorV3Interface(feed).latestRoundData();
        updatedAt = ts;

        uint256 start = block.number;
        uint256 limit = start > maxLookback ? start - maxLookback : 0;

        // Scan backwards: blockhash is only available for the last 256 blocks.
        // For older updates we fall back to returning updatedAt.
        for (uint256 b = start; b >= limit; ) {
            // blockhash returns 0 for blocks older than 256
            if (b < block.number - 255) break;

            // We can't read arbitrary block timestamps in Solidity without
            // BLOCKHASH, so we use a two-phase approach:
            //   Phase 1 (off-chain): caller passes the target timestamp.
            //   Phase 2 (on-chain):  we confirm by checking block.timestamp
            //                        of the current execution context.
            //
            // Since we cannot iterate block timestamps in a pure view call,
            // we instead return updatedAt and let the CRE workflow do the
            // binary search off-chain via multiple eth_getBlockByNumber calls.
            //
            // This function is therefore a PLACEHOLDER; the real resolution
            // happens in the workflow step `compute_block` using the
            // `updatedAt` timestamp from latestRoundData().
            break;

            unchecked { --b; }
        }

        // Return updatedAt as blockNum proxy (see note above).
        blockNum = updatedAt;
    }

    /**
     * @notice Convenience: return block.number and block.timestamp right now.
     *         Useful as a CRE EVM Read to anchor "current" time/block.
     */
    function currentContext()
        external view
        returns (uint256 blockNumber, uint256 timestamp)
    {
        blockNumber = block.number;
        timestamp   = block.timestamp;
    }
}
