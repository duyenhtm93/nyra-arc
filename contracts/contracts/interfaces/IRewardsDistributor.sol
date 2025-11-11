// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRewardsDistributor {
    function onAction(address user, uint256 usdSupplied, uint256 usdBorrowed) external;
    function claim(address user) external returns (uint256);
    function setEmissionPerSec(uint256 perSec) external;
}

