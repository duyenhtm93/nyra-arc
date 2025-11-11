// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TestToken is ERC20, Ownable {
    uint8 private _decimals;
    uint256 public faucetAmount;
    mapping(address => bool) public hasClaimedFaucet;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        address initialOwner,
        uint256 initialMint
    ) ERC20(name, symbol) Ownable(initialOwner) {
        _decimals = decimals_;
        _mint(initialOwner, initialMint);
        _transferOwnership(initialOwner);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setFaucetAmount(uint256 amount) external onlyOwner {
        faucetAmount = amount;
    }

    function faucet() external {
        require(faucetAmount > 0, "Faucet disabled");
        require(!hasClaimedFaucet[msg.sender], "Faucet already claimed");

        hasClaimedFaucet[msg.sender] = true;
        _mint(msg.sender, faucetAmount);
    }
}
