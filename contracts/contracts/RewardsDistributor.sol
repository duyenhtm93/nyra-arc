// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IRewardsDistributor.sol";

contract RewardsDistributor is Ownable, IRewardsDistributor {
    using SafeERC20 for IERC20;

    uint256 private constant ACC_PRECISION = 1e18;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    IERC20 public immutable rewardToken;
    address public pointsManager;

    uint256 public emissionPerSec;
    uint256 public borrowWeightBps = 15_000; // borrowers mặc định 1.5x

    uint256 public totalPoints;
    uint256 public accRewardPerPoint;
    uint256 public lastUpdate;

    struct UserInfo {
        uint256 points;
        uint256 rewardDebt;
        uint256 pending;
    }

    mapping(address => UserInfo) public users;

    event Funded(address indexed funder, uint256 amount);
    event EmissionUpdated(uint256 newEmissionPerSec);
    event BorrowWeightUpdated(uint256 newBorrowWeightBps);
    event PointsManagerUpdated(address indexed newManager);
    event RewardsClaimed(address indexed user, uint256 amount);
    event PointsUpdated(address indexed user, uint256 newPoints);

    modifier onlyManager() {
        require(msg.sender == pointsManager, "Not manager");
        _;
    }

    constructor(address _rewardToken, address _owner, address _pointsManager) Ownable(_owner) {
        require(_rewardToken != address(0), "reward=0");
        rewardToken = IERC20(_rewardToken);
        pointsManager = _pointsManager;
        lastUpdate = block.timestamp;
    }

    function setPointsManager(address manager) external onlyOwner {
        pointsManager = manager;
        emit PointsManagerUpdated(manager);
    }

    function onAction(address user, uint256 usdSupplied, uint256 usdBorrowed) external override onlyManager {
        require(user != address(0), "user=0");
        _updateGlobalState();

        uint256 weightedBorrow = (usdBorrowed * borrowWeightBps) / BPS_DENOMINATOR;
        uint256 newPoints = (usdSupplied + weightedBorrow) * 1e10; // scale 8 decimals -> 18

        UserInfo storage info = users[user];

        if (newPoints == info.points) {
            info.rewardDebt = (info.points * accRewardPerPoint) / ACC_PRECISION;
            return;
        }

        if (info.points > 0) {
            uint256 accumulated = (info.points * accRewardPerPoint) / ACC_PRECISION;
            if (accumulated > info.rewardDebt) {
                info.pending += accumulated - info.rewardDebt;
            }
        }

        require(totalPoints >= info.points, "Invariant: totalPoints < user points");
        totalPoints = totalPoints - info.points + newPoints;

        info.points = newPoints;
        info.rewardDebt = (newPoints * accRewardPerPoint) / ACC_PRECISION;

        emit PointsUpdated(user, newPoints);
    }

    function claim(address user) external override onlyManager returns (uint256) {
        return _claimFor(user);
    }

    function claim(address user, address recipient) external onlyOwner returns (uint256) {
        return _claimTo(user, recipient);
    }

    function claimForSelf() external returns (uint256) {
        return _claimTo(msg.sender, msg.sender);
    }

    function setEmissionPerSec(uint256 perSec) external override onlyOwner {
        _updateGlobalState();
        emissionPerSec = perSec;
        emit EmissionUpdated(perSec);
    }

    function setBorrowWeightBps(uint256 newWeightBps) external onlyOwner {
        require(newWeightBps >= BPS_DENOMINATOR, "Weight too low");
        borrowWeightBps = newWeightBps;
        emit BorrowWeightUpdated(newWeightBps);
    }

    function fund(uint256 amount) external onlyOwner {
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function pendingRewards(address user) external view returns (uint256) {
        UserInfo memory info = users[user];
        uint256 tempAcc = accRewardPerPoint;
        if (block.timestamp > lastUpdate && emissionPerSec > 0 && totalPoints > 0) {
            uint256 elapsed = block.timestamp - lastUpdate;
            uint256 rewards = emissionPerSec * elapsed;
            tempAcc += (rewards * ACC_PRECISION) / totalPoints;
        }
        uint256 accumulated = (info.points * tempAcc) / ACC_PRECISION;
        uint256 pending = info.pending;
        if (accumulated > info.rewardDebt) {
            pending += accumulated - info.rewardDebt;
        }
        return pending;
    }

    function _claimFor(address user) internal returns (uint256) {
        return _claimTo(user, user);
    }

    function _claimTo(address user, address recipient) internal returns (uint256) {
        require(recipient != address(0), "recipient=0");
        _updateGlobalState();

        UserInfo storage info = users[user];
        uint256 accumulated = (info.points * accRewardPerPoint) / ACC_PRECISION;
        if (accumulated > info.rewardDebt) {
            info.pending += accumulated - info.rewardDebt;
        }

        uint256 amount = info.pending;
        if (amount > 0) {
            uint256 balance = rewardToken.balanceOf(address(this));
            if (amount > balance) {
                amount = balance;
            }
            info.pending -= amount;
            rewardToken.safeTransfer(recipient, amount);
            emit RewardsClaimed(user, amount);
        }

        info.rewardDebt = (info.points * accRewardPerPoint) / ACC_PRECISION;
        return amount;
    }

    function _updateGlobalState() internal {
        if (block.timestamp <= lastUpdate) {
            return;
        }

        if (totalPoints > 0 && emissionPerSec > 0) {
            uint256 elapsed = block.timestamp - lastUpdate;
            uint256 rewards = emissionPerSec * elapsed;
            accRewardPerPoint += (rewards * ACC_PRECISION) / totalPoints;
        }

        lastUpdate = block.timestamp;
    }
}

