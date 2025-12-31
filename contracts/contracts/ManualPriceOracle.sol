// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ManualPriceOracle
 * @dev Stores USD prices (8 decimals) for supported tokens. USDC is hard-coded
 *      to $1.00, other tokens must be updated by the owner (e.g., via off-chain bot).
 */
contract ManualPriceOracle is Ownable {
    struct PriceData {
        uint256 price;      // USD price with 8 decimals
        uint256 updatedAt;  // last update timestamp
    }

    event PriceUpdated(address indexed token, uint256 price, uint256 timestamp);

    uint256 public constant MAX_STALE_TIME = 10 minutes;
    address public immutable usdc;

    mapping(address => PriceData) private prices;
    mapping(address => bool) public isKeeper;

    modifier onlyKeeper() {
        require(msg.sender == owner() || isKeeper[msg.sender], "ManualPriceOracle: unauthorized");
        _;
    }

    constructor(address _usdc, address initialOwner) Ownable(initialOwner) {
        require(_usdc != address(0), "ManualPriceOracle: invalid USDC");
        usdc = _usdc;
    }

    function setKeeper(address keeper, bool status) external onlyOwner {
        isKeeper[keeper] = status;
    }

    function setPrice(address token, uint256 price) external onlyKeeper {
        require(token != address(0), "ManualPriceOracle: invalid token");
        require(token != usdc, "ManualPriceOracle: USDC immutable");
        _setPrice(token, price);
    }

    function setPrices(address[] calldata tokens, uint256[] calldata priceList) external onlyKeeper {
        require(tokens.length == priceList.length, "ManualPriceOracle: length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0), "ManualPriceOracle: invalid token");
            require(tokens[i] != usdc, "ManualPriceOracle: USDC immutable");
            _setPrice(tokens[i], priceList[i]);
        }
    }

    function getPrice(address token) external view returns (uint256) {
        if (token == usdc) {
            return 1e8;
        }
        PriceData memory data = prices[token];
        require(data.price > 0, "ManualPriceOracle: price not set");
        require(block.timestamp - data.updatedAt <= MAX_STALE_TIME, "ManualPriceOracle: price stale");
        return data.price;
    }

    function _setPrice(address token, uint256 price) internal {
        require(price > 0, "ManualPriceOracle: invalid price");
        prices[token] = PriceData({ price: price, updatedAt: block.timestamp });
        emit PriceUpdated(token, price, block.timestamp);
    }
}

