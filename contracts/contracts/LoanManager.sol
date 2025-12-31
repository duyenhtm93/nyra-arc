// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IRewardsDistributor.sol";

interface ICollateralManager {
    function getHealthFactor(address user) external view returns (uint256);
    function getCollateralValueUSD(address user) external view returns (uint256);
}

interface IPriceOracle {
    function getPrice(address token) external view returns (uint256);
}

contract LoanManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ===== CONSTANTS =====
    uint256 public constant RAY = 1e27; // Precision for interest indexes
    uint256 public constant SECONDS_PER_YEAR = 31536000;

    // ===== DATA STRUCTURES =====
    struct RateModelConfig {
        uint256 baseRate;      // Lãi suất gốc (bps, e.g. 200 = 2%)
        uint256 slope1;        // Lãi suất tăng thêm đến điểm optimal (bps)
        uint256 slope2;        // Lãi suất tăng vọt sau điểm optimal (bps)
        uint256 optimalUtil;   // Điểm tối ưu (bps, e.g. 8000 = 80%)
    }

    struct TreasuryStats {
        uint256 totalDeposits;      // Tổng gốc (scaled)
        uint256 totalBorrows;       // Tổng nợ (scaled)
        uint256 lastUpdate;         // Timestamp cuối cùng cập nhật index
        uint256 borrowIndex;        // Chỉ số nợ tích lũy (RAY)
        uint256 supplyIndex;        // Chỉ số lãi tích lũy (RAY)
        uint256 reserveFactor;      // Phần trăm phí protocol giữ lại (bps)
    }

    struct Loan {
        address token;
        uint256 scaledPrincipal;    // Nợ đã quy đổi theo index (scaledAmount = actualAmount / index)
        bool active;
    }

    struct Lender {
        uint256 scaledBalance;      // Tiền gửi đã quy đổi theo index
    }

    // ===== STATE =====
    mapping(address => Loan) public loans;
    mapping(address => mapping(address => Lender)) public lenders;
    mapping(address => TreasuryStats) public treasury;
    mapping(address => RateModelConfig) public rateConfigs;
    mapping(address => bool) public isSupportedToken;
    address[] private _supportedTokens;

    mapping(address => uint256) public protocolProfit;
    mapping(address => bool) public isBorrower;
    address[] public activeBorrowers;
    mapping(address => uint256) private activeBorrowerIndex;

    ICollateralManager public collateralManager;
    IPriceOracle public priceOracle;
    IRewardsDistributor public rewardsDistributor;
    IERC20 public rewardToken;

    // ===== EVENTS =====
    event TokenSupported(address token, uint256 baseRate, uint256 slope1, uint256 slope2, uint256 optimalUtil);
    event InterestAccrued(address indexed token, uint256 borrowRate, uint256 borrowIndex, uint256 supplyIndex);
    event DepositedToPool(address indexed user, address token, uint256 amount, uint256 scaledAmount);
    event Withdrawn(address indexed user, address token, uint256 amount, uint256 scaledAmount);
    event LoanRequested(address indexed user, address token, uint256 amount, uint256 scaledAmount);
    event LoanRepaid(address indexed user, address token, uint256 amount, uint256 scaledAmount);

    constructor(address _collateralManager, address initialOwner) Ownable(initialOwner) {
        collateralManager = ICollateralManager(_collateralManager);
    }

    // ===== ADMIN =====
    function setPriceOracle(address _oracle) external onlyOwner {
        priceOracle = IPriceOracle(_oracle);
    }

    function supportToken(
        address token,
        uint256 baseRate,
        uint256 slope1,
        uint256 slope2,
        uint256 optimalUtil,
        uint256 reserveFactor
    ) external onlyOwner {
        require(token != address(0), "Invalid token");
        require(optimalUtil <= 10000 && reserveFactor <= 10000, "Invalid bps");

        rateConfigs[token] = RateModelConfig(baseRate, slope1, slope2, optimalUtil);
        
        if (!isSupportedToken[token]) {
            _supportedTokens.push(token);
            isSupportedToken[token] = true;
            treasury[token].borrowIndex = RAY;
            treasury[token].supplyIndex = RAY;
            treasury[token].lastUpdate = block.timestamp;
        }
        
        treasury[token].reserveFactor = reserveFactor;
        emit TokenSupported(token, baseRate, slope1, slope2, optimalUtil);
    }

    // ===== CORE ACCRUAL LOGIC =====

    function getUtilizationRate(address token) public view returns (uint256) {
        TreasuryStats storage stats = treasury[token];
        uint256 totalBorrows = (stats.totalBorrows * stats.borrowIndex) / RAY;
        uint256 totalDeposits = (stats.totalDeposits * stats.supplyIndex) / RAY;
        
        if (totalDeposits == 0) return 0;
        return (totalBorrows * 10000) / totalDeposits;
    }

    function getBorrowRate(address token) public view returns (uint256) {
        uint256 util = getUtilizationRate(token);
        RateModelConfig storage config = rateConfigs[token];

        if (util <= config.optimalUtil) {
            return config.baseRate + (util * config.slope1) / config.optimalUtil;
        } else {
            uint256 excessUtil = util - config.optimalUtil;
            return config.baseRate + config.slope1 + (excessUtil * config.slope2) / (10000 - config.optimalUtil);
        }
    }

    function getSupplyRate(address token) public view returns (uint256) {
        uint256 borrowRate = getBorrowRate(token);
        uint256 util = getUtilizationRate(token);
        uint256 reserveFactor = treasury[token].reserveFactor;

        return (borrowRate * util * (10000 - reserveFactor)) / 100000000;
    }

    function accrueInterest(address token) public {
        TreasuryStats storage stats = treasury[token];
        if (block.timestamp == stats.lastUpdate) return;

        uint256 borrowRate = getBorrowRate(token);
        uint256 supplyRate = getSupplyRate(token);
        uint256 timeElapsed = block.timestamp - stats.lastUpdate;

        if (timeElapsed > 0) {
            // New Index = Current Index * (1 + (rate * time) / seconds_per_year)
            uint256 borrowInterest = (borrowRate * timeElapsed * RAY) / (10000 * SECONDS_PER_YEAR);
            stats.borrowIndex = (stats.borrowIndex * (RAY + borrowInterest)) / RAY;

            uint256 supplyInterest = (supplyRate * timeElapsed * RAY) / (10000 * SECONDS_PER_YEAR);
            stats.supplyIndex = (stats.supplyIndex * (RAY + supplyInterest)) / RAY;
        }

        stats.lastUpdate = block.timestamp;
        emit InterestAccrued(token, borrowRate, stats.borrowIndex, stats.supplyIndex);
    }

    // ===== LENDING (SUPPLY SIDE) =====

    function depositToPool(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount=0");
        require(isSupportedToken[token], "Unsupported");

        accrueInterest(token);
        TreasuryStats storage stats = treasury[token];

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 scaledAmount = (amount * RAY) / stats.supplyIndex;
        lenders[msg.sender][token].scaledBalance += scaledAmount;
        stats.totalDeposits += scaledAmount;

        emit DepositedToPool(msg.sender, token, amount, scaledAmount);
        _notifyRewards(msg.sender);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        accrueInterest(token);
        TreasuryStats storage stats = treasury[token];
        Lender storage lender = lenders[msg.sender][token];

        uint256 currentBalance = (lender.scaledBalance * stats.supplyIndex) / RAY;
        if (amount == type(uint256).max) amount = currentBalance;

        require(amount > 0 && amount <= currentBalance, "Invalid balance");
        require(IERC20(token).balanceOf(address(this)) >= amount, "No liquidity");

        uint256 scaledAmount = (amount * RAY) / stats.supplyIndex;
        lender.scaledBalance -= scaledAmount;
        stats.totalDeposits -= scaledAmount;

        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount, scaledAmount);
        _notifyRewards(msg.sender);
    }

    function withdrawAll(address token) external {
        this.withdraw(token, type(uint256).max);
    }

    // ===== BORROWING (DEBT SIDE) =====

    function requestLoan(address token, uint256 amount, uint256 /*duration*/) external nonReentrant {
        require(!loans[msg.sender].active, "Active loan exists");
        require(isSupportedToken[token], "Unsupported");

        accrueInterest(token);
        TreasuryStats storage stats = treasury[token];

        require(collateralManager.getHealthFactor(msg.sender) >= 1e18, "Unhealthy");
        require(IERC20(token).balanceOf(address(this)) >= amount, "No liquidity");

        uint256 scaledAmount = (amount * RAY) / stats.borrowIndex;
        loans[msg.sender] = Loan(token, scaledAmount, true);
        stats.totalBorrows += scaledAmount;

        if (!isBorrower[msg.sender]) {
            isBorrower[msg.sender] = true;
            activeBorrowers.push(msg.sender);
            activeBorrowerIndex[msg.sender] = activeBorrowers.length;
        }

        IERC20(token).safeTransfer(msg.sender, amount);
        emit LoanRequested(msg.sender, token, amount, scaledAmount);
        _notifyRewards(msg.sender);
    }

    function repay(address token, uint256 amount) external nonReentrant {
        _repayInternal(msg.sender, msg.sender, token, amount);
    }

    function repayAll(address token) external nonReentrant {
        uint256 debt = getOutstandingLoan(msg.sender);
        _repayInternal(msg.sender, msg.sender, token, debt);
    }

    function repayFor(address borrower, address token, uint256 amount) external nonReentrant {
        _repayInternal(msg.sender, borrower, token, amount);
    }

    function _repayInternal(address payer, address borrower, address token, uint256 amount) internal {
        Loan storage loan = loans[borrower];
        require(loan.active, "No active loan");
        require(token == loan.token, "Wrong token");

        accrueInterest(token);
        TreasuryStats storage stats = treasury[token];

        uint256 currentDebt = (loan.scaledPrincipal * stats.borrowIndex) / RAY;
        if (amount > currentDebt) amount = currentDebt;

        IERC20(token).safeTransferFrom(payer, address(this), amount);

        uint256 scaledAmount = (amount * RAY) / stats.borrowIndex;
        loan.scaledPrincipal -= scaledAmount;
        stats.totalBorrows -= scaledAmount;

        if (loan.scaledPrincipal == 0) {
            loan.active = false;
            loan.token = address(0);
            _removeActiveBorrower(borrower);
        }

        emit LoanRepaid(borrower, token, amount, scaledAmount);
        _notifyRewards(borrower);
    }

    // ===== VIEW HIGHLIGHTS =====

    function getOutstandingLoan(address user) public view returns (uint256) {
        Loan memory loan = loans[user];
        if (!loan.active) return 0;
        
        // Dynamic view: Apply projected interest until now
        uint256 borrowRate = getBorrowRate(loan.token);
        uint256 timeElapsed = block.timestamp - treasury[loan.token].lastUpdate;
        uint256 borrowInterest = (borrowRate * timeElapsed * RAY) / (10000 * SECONDS_PER_YEAR);
        uint256 currentIndex = (treasury[loan.token].borrowIndex * (RAY + borrowInterest)) / RAY;
        
        return (loan.scaledPrincipal * currentIndex) / RAY;
    }

    function getOutstandingLoanUSD(address user) public view returns (uint256) {
        Loan memory loan = loans[user];
        if (!loan.active) return 0;
        uint256 debtRaw = getOutstandingLoan(user);
        uint256 px = priceOracle.getPrice(loan.token);
        uint8 dec = IERC20Metadata(loan.token).decimals();
        return (debtRaw * px) / (10 ** dec);
    }

    function getAvailableToWithdraw(address user, address token) external view returns (uint256) {
        Lender memory lender = lenders[user][token];
        if (lender.scaledBalance == 0) return 0;
        
        uint256 supplyRate = getSupplyRate(token);
        uint256 timeElapsed = block.timestamp - treasury[token].lastUpdate;
        uint256 supplyInterest = (supplyRate * timeElapsed * RAY) / (10000 * SECONDS_PER_YEAR);
        uint256 currentIndex = (treasury[token].supplyIndex * (RAY + supplyInterest)) / RAY;
        
        return (lender.scaledBalance * currentIndex) / RAY;
    }

    function getLoanToken(address user) external view returns (address) { return loans[user].token; }
    function getAvailableLiquidity(address token) external view returns (uint256) { return IERC20(token).balanceOf(address(this)); }

    // ===== INTERNAL UTILS =====

    function _removeActiveBorrower(address borrower) internal {
        uint256 indexPlusOne = activeBorrowerIndex[borrower];
        if (indexPlusOne == 0) return;
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = activeBorrowers.length - 1;
        if (index != lastIndex) {
            address lastBorrower = activeBorrowers[lastIndex];
            activeBorrowers[index] = lastBorrower;
            activeBorrowerIndex[lastBorrower] = index + 1;
        }
        activeBorrowers.pop();
        activeBorrowerIndex[borrower] = 0;
        isBorrower[borrower] = false;
    }

    function _notifyRewards(address user) internal {
        if (address(rewardsDistributor) == address(0) || user == address(0)) return;
        // Total USD valuation for rewards
        uint256 usdSupplied = 0;
        for(uint i=0; i < _supportedTokens.length; i++) {
            address token = _supportedTokens[i];
            Lender memory l = lenders[user][token];
            if (l.scaledBalance > 0) {
                uint256 currentBal = (l.scaledBalance * treasury[token].supplyIndex) / RAY;
                uint256 px = priceOracle.getPrice(token);
                usdSupplied += (currentBal * px) / (10 ** IERC20Metadata(token).decimals());
            }
        }
        uint256 usdBorrowed = getOutstandingLoanUSD(user);
        rewardsDistributor.onAction(user, usdSupplied, usdBorrowed);
    }

    function setRewardsDistributor(address distributor) external onlyOwner { rewardsDistributor = IRewardsDistributor(distributor); }
    function setRewardToken(address _token) external onlyOwner { rewardToken = IERC20(_token); }
}
