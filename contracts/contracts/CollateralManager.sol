// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPriceOracle {
    function getPrice(address token) external view returns (uint256);
}

interface IERC20Metadata is IERC20 {
    function decimals() external view returns (uint8);
}

interface ILoanManager {
    function getOutstandingLoanUSD(address user) external view returns (uint256); // ✅ NEW
    function getLoanToken(address user) external view returns (address);          // ✅ NEW
    function repayFor(address borrower, address token, uint256 amount) external;
}

contract CollateralManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    // ====== STRUCTS ======
    struct CollateralConfig {
        bool allowed;
        uint8 ltv;                  // Loan-to-Value ratio (e.g. 80)
        uint8 liquidationThreshold; // Ngưỡng thanh lý (e.g. 85)
    }

    // ====== STATE ======
    mapping(address => mapping(address => uint256)) public collateralBalances; // user => token => amount
    mapping(address => CollateralConfig) public tokenConfig;                   // token => config
    address[] public allowedTokens;

    IPriceOracle public priceOracle;
    ILoanManager public loanManager;

    uint16 public closeFactorBps = 5_000;       // 50% tối đa mỗi lần thanh lý
    uint16 public liquidationBonusBps = 500;    // 5% thưởng cho liquidator

    // ====== EVENTS ======
    event CollateralDeposited(address indexed user, address indexed token, uint256 amount);
    event CollateralWithdrawn(address indexed user, address indexed token, uint256 amount);
    event CollateralLiquidated(address indexed borrower, address indexed token, address liquidator, uint256 repayAmount, uint256 collateralSeized);

    // ====== CONSTRUCTOR ======
    constructor(address _oracle, address _loanManager, address initialOwner) Ownable(initialOwner) {
        priceOracle = IPriceOracle(_oracle);
        loanManager = ILoanManager(_loanManager);
    }

    // ====== ADMIN ======
    function setLoanManager(address _loanManager) external onlyOwner {
        require(_loanManager != address(0), "Invalid address");
        loanManager = ILoanManager(_loanManager);
    }

    function setPriceOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid oracle");
        priceOracle = IPriceOracle(_oracle);
    }

    function addAllowedToken(address token, uint8 ltv, uint8 liquidationThreshold) external onlyOwner {
        require(!tokenConfig[token].allowed, "Already allowed");
        require(ltv > 0 && liquidationThreshold > ltv, "Invalid config");

        tokenConfig[token] = CollateralConfig({
            allowed: true,
            ltv: ltv,
            liquidationThreshold: liquidationThreshold
        });

        allowedTokens.push(token);
    }

    function updateTokenLTV(address token, uint8 newLtv, uint8 newThreshold) external onlyOwner {
        require(tokenConfig[token].allowed, "Token not allowed");
        require(newLtv > 0 && newThreshold > newLtv, "Invalid LTV");
        tokenConfig[token].ltv = newLtv;
        tokenConfig[token].liquidationThreshold = newThreshold;
    }

    function setLiquidationParams(uint16 newCloseFactorBps, uint16 newBonusBps) external onlyOwner {
        require(newCloseFactorBps > 0 && newCloseFactorBps <= 10_000, "Bad close factor");
        require(newBonusBps <= 5_000, "Bonus too high");
        closeFactorBps = newCloseFactorBps;
        liquidationBonusBps = newBonusBps;
    }

    // ====== CORE: DEPOSIT / WITHDRAW ======
    function deposit(address token, uint256 amount) external nonReentrant {
        require(tokenConfig[token].allowed, "Token not allowed");
        require(amount > 0, "Invalid amount");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        collateralBalances[msg.sender][token] += amount;

        emit CollateralDeposited(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        require(tokenConfig[token].allowed, "Token not allowed");
        require(amount > 0, "Invalid amount");
        require(collateralBalances[msg.sender][token] >= amount, "Insufficient balance");

        collateralBalances[msg.sender][token] -= amount;

        require(getHealthFactor(msg.sender) >= 1e18, "Cannot withdraw - risk too high");

        IERC20(token).safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, token, amount);
    }

    /// @notice Rút toàn bộ tài sản thế chấp (khi không còn nợ)
    function withdrawAllCollateral() external nonReentrant {
        uint256 hf = getHealthFactor(msg.sender);
        require(hf >= 1e18, "Risk too high");

        for (uint i = 0; i < allowedTokens.length; i++) {
            address token = allowedTokens[i];
            uint256 balance = collateralBalances[msg.sender][token];
            if (balance == 0) continue;

            collateralBalances[msg.sender][token] = 0;
            IERC20(token).safeTransfer(msg.sender, balance);
            emit CollateralWithdrawn(msg.sender, token, balance);
        }
    }

    // ====== VALUATION ======
    function getCollateralValueUSD(address user) public view returns (uint256 totalValue) {
        for (uint i = 0; i < allowedTokens.length; i++) {
            address token = allowedTokens[i];
            uint256 balance = collateralBalances[user][token];
            if (balance > 0) {
                uint256 price = priceOracle.getPrice(token); // 8 decimals
                require(price > 0, "Bad price");
                uint8 decimals = IERC20Metadata(token).decimals();
                totalValue += (balance * price) / (10 ** decimals);
            }
        }
    }

    function getMaxLoanAllowedUSD(address user) public view returns (uint256 totalUSD) {
        for (uint i = 0; i < allowedTokens.length; i++) {
            address token = allowedTokens[i];
            uint256 balance = collateralBalances[user][token];
            if (balance == 0) continue;

            uint256 price = priceOracle.getPrice(token);
            require(price > 0, "Bad price");
            uint8 decimals = IERC20Metadata(token).decimals();
            uint8 ltv = tokenConfig[token].ltv;

            uint256 valueUSD = (balance * price) / (10 ** decimals);
            totalUSD += (valueUSD * ltv) / 100;
        }
    }

    // ====== HEALTH FACTOR ======
    function getHealthFactor(address user) public view returns (uint256) {
        uint256 debtUSD = loanManager.getOutstandingLoanUSD(user); // ✅ CHANGED
        if (debtUSD == 0) return type(uint256).max;

        uint256 collateralUSD = getCollateralValueUSD(user);
        uint8 weightedThreshold = getWeightedLiquidationThreshold(user);

        return (collateralUSD * weightedThreshold * 1e18) / (debtUSD * 100);
    }

    function getWeightedLiquidationThreshold(address user) internal view returns (uint8) {
        uint256 totalUSD = 0;
        uint256 weightedSum = 0;
        for (uint i = 0; i < allowedTokens.length; i++) {
            address token = allowedTokens[i];
            uint256 bal = collateralBalances[user][token];
            if (bal == 0) continue;
            uint256 price = priceOracle.getPrice(token);
            require(price > 0, "Bad price");
            uint8 decimals = IERC20Metadata(token).decimals();
            uint256 val = (bal * price) / (10 ** decimals);
            totalUSD += val;
            weightedSum += val * tokenConfig[token].liquidationThreshold;
        }
        return totalUSD == 0 ? 0 : uint8(weightedSum / totalUSD);
    }

    // ====== LIQUIDATION ======
    function liquidate(address borrower, address repayToken, uint256 repayAmount, address collateralToken) external nonReentrant {
        require(tokenConfig[collateralToken].allowed, "Collateral not allowed");
        require(repayAmount > 0, "Amount=0");
        uint256 hf = getHealthFactor(borrower);
        require(hf < 1e18, "Healthy account");
        uint256 outstandingUSD = loanManager.getOutstandingLoanUSD(borrower);
        require(outstandingUSD > 0, "No debt");

        IERC20(repayToken).safeTransferFrom(msg.sender, address(this), repayAmount);

        uint256 maxRepayUSD = (outstandingUSD * closeFactorBps) / 10_000;
        uint256 collateralToSeize = _repayAndComputeSeize(
            borrower,
            repayToken,
            repayAmount,
            collateralToken,
            maxRepayUSD
        );

        uint256 userBalance = collateralBalances[borrower][collateralToken];
        if (collateralToSeize > userBalance) collateralToSeize = userBalance;

        collateralBalances[borrower][collateralToken] -= collateralToSeize;
        IERC20(collateralToken).safeTransfer(msg.sender, collateralToSeize);

        emit CollateralLiquidated(borrower, collateralToken, msg.sender, repayAmount, collateralToSeize);
    }

    function _repayAndComputeSeize(
        address borrower,
        address repayToken,
        uint256 repayAmount,
        address collateralToken,
        uint256 maxRepayUSD
    ) internal returns (uint256 collateralToSeize) {
        uint256 repayTokenPrice = priceOracle.getPrice(repayToken);
        uint256 collateralPrice = priceOracle.getPrice(collateralToken);
        require(repayTokenPrice > 0 && collateralPrice > 0, "Bad price");

        uint8 repayDecimals = IERC20Metadata(repayToken).decimals();
        uint8 collateralDecimals = IERC20Metadata(collateralToken).decimals();

        uint256 repayValueUSD = (repayAmount * repayTokenPrice) / (10 ** repayDecimals);
        require(repayValueUSD <= maxRepayUSD, "Close factor exceeded");

        IERC20 repayTokenContract = IERC20(repayToken);
        uint256 currentAllowance = repayTokenContract.allowance(address(this), address(loanManager));
        if (currentAllowance > 0) {
            repayTokenContract.safeDecreaseAllowance(address(loanManager), currentAllowance);
        }
        repayTokenContract.safeIncreaseAllowance(address(loanManager), repayAmount);
        loanManager.repayFor(borrower, repayToken, repayAmount);
        repayTokenContract.safeDecreaseAllowance(address(loanManager), repayAmount);

        uint256 seizeValueUSD = (repayValueUSD * (10_000 + liquidationBonusBps)) / 10_000;
        collateralToSeize = (seizeValueUSD * (10 ** collateralDecimals)) / collateralPrice;
    }

    // ====== VIEW HELPERS ======
    function allowedTokensLength() external view returns (uint) {
        return allowedTokens.length;
    }

    function getCollateralValueUSDByToken(address user, address token) external view returns (uint256) {
        uint256 bal = collateralBalances[user][token];
        if (bal == 0) return 0;
        uint256 price = priceOracle.getPrice(token);
        require(price > 0, "Bad price");
        uint8 decimals = IERC20Metadata(token).decimals();
        return (bal * price) / (10 ** decimals);
    }

    /// @notice Dashboard tổng hợp cho UI
    function getUserCollateralData(address user)
        external
        view
        returns (
            uint256 totalCollateralUSD,
            uint256 maxLoanUSD,
            uint256 debtUSD,
            uint256 healthFactor
        )
    {
        totalCollateralUSD = getCollateralValueUSD(user);
        maxLoanUSD = getMaxLoanAllowedUSD(user);
        debtUSD = loanManager.getOutstandingLoanUSD(user); // ✅ CHANGED
        healthFactor = getHealthFactor(user);
    }
}
