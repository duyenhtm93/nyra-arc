// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NYRAToken
 * @notice Governance & rewards token with fixed 100M supply minted to treasury.
 */
contract NYRAToken is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 100_000_000e18;

    constructor(address treasury) ERC20("NYRA", "NYRA") Ownable(msg.sender) {
        require(treasury != address(0), "treasury=0");
        _mint(treasury, TOTAL_SUPPLY);
    }
}

