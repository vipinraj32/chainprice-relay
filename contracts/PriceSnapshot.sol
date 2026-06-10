// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISnapshot {
    struct Record {
        string  token;
        uint256 price;
        uint256 blockNumber;
        uint256 timestamp;
    }
}

contract PriceSnapshot is ISnapshot {
    // ----------------------------------------------------------------
    // State
    // ----------------------------------------------------------------

    address public immutable forwarder;
    address public owner;

    /// @notice Latest snapshot per token symbol (upper-cased)
    mapping(string => Record) public latestRecord;

    /// @notice All historical snapshots per token
    mapping(string => Record[]) public history;

    // ----------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------

    event SnapshotRecorded(
        string  indexed token,
        uint256 price,
        uint256 blockNumber,
        uint256 timestamp
    );

    // ----------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------

    error NotForwarder(address caller);
    error NotOwner(address caller);

    // ----------------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------------

    /// @param _forwarder  The CRE forwarder address that is allowed to
    ///                    call `snapshot`.  Only this address can write.
    constructor(address _forwarder) {
        require(_forwarder != address(0), "forwarder: zero address");
        forwarder = _forwarder;
        owner = msg.sender;
    }

    // ----------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------

    modifier onlyForwarder() {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    // ----------------------------------------------------------------
    // Core function
    // ----------------------------------------------------------------

    /// @notice Record a price snapshot on-chain.
    /// @param token        Token symbol, e.g. "ETH"
    /// @param price        Current USD price scaled by 1e8 (Chainlink convention)
    /// @param blockNumber  Block number at which the Data Feed was last updated
    ///                     (taken from Chainlink aggregator's `updatedAt` round data)
    /// @param timestamp    Unix timestamp at which the Data Feed was last updated
    function snapshot(
        string  calldata token,
        uint256 price,
        uint256 blockNumber,
        uint256 timestamp
    )
        external
        onlyForwarder
    {
        Record memory rec = Record({
            token:       token,
            price:       price,
            blockNumber: blockNumber,
            timestamp:   timestamp
        });

        latestRecord[token] = rec;
        history[token].push(rec);

        emit SnapshotRecorded(token, price, blockNumber, timestamp);
    }

    // ----------------------------------------------------------------
    // View helpers
    // ----------------------------------------------------------------

    function getLatestRecord(string calldata token)
        external view returns (Record memory)
    {
        return latestRecord[token];
    }

    function getHistoryLength(string calldata token)
        external view returns (uint256)
    {
        return history[token].length;
    }

    function getHistoricalRecord(string calldata token, uint256 index)
        external view returns (Record memory)
    {
        return history[token][index];
    }

    // ----------------------------------------------------------------
    // Admin
    // ----------------------------------------------------------------

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }
}
