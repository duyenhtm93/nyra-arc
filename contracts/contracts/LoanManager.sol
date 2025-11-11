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
    /// @notice Trả về giá USD 8 decimals cho mỗi 1 token (price * 1e8)
    function getPrice(address token) external view returns (uint256);
}

contract LoanManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    // ===== DATA =====
    struct Loan {
        address token;        // <— NEW: token đang vay
        uint256 principal;    // gốc đang nợ (token units)
        uint256 rate;         // borrowRate (bps)
        uint256 totalInterest;// tổng lãi đã trả
        uint256 createdAt;    // mốc tính lãi hiện tại
        uint256 duration;     // thời hạn vay (tuỳ UI)
        bool active;
    }

    struct InterestRates {
        uint256 borrowRate; // bps
        uint256 lendRate;   // bps
    }

    struct Lender {
        uint256 deposited;     // gốc đã gửi
        uint256 depositTime;   // mốc tính lãi hiện tại cho phần gửi
        uint256 rewardClaimed; // lãi đã ghi nhận (để trừ khi tính pending)
    }

    struct TreasuryStats {
        uint256 totalDeposits;    // tổng GỐC đã gửi vào pool (kế toán)
        uint256 totalBorrows;     // tổng gốc đã cho vay ra
        uint256 totalRepayments;  // tổng tiền trả nợ đã nhận về
    }

    // ===== STATE =====
    mapping(address => Loan) public loans;                           // borrower => Loan
    mapping(address => InterestRates) public ratesByToken;           // token => rates
    mapping(address => bool) public isSupportedToken;                // token => lending whitelist
    mapping(address => mapping(address => Lender)) public lenders;   // user => token => Lender
    mapping(address => TreasuryStats) public treasury;               // token => stats
    mapping(address => uint256) public protocolProfit;               // token => accumulated protocol profit

    // Liquidator helper
    address[] public activeBorrowers;            // <— NEW
    mapping(address => bool) public isBorrower;  // <— NEW
    mapping(address => uint256) private activeBorrowerIndex; // borrower => index+1

    ICollateralManager public collateralManager;
    IPriceOracle public priceOracle;             // <— NEW
    IERC20 public rewardToken; // optional legacy reward
    IRewardsDistributor public rewardsDistributor;

    // ===== EVENTS =====
    event TokenSupported(address token, uint256 borrowRateBps, uint256 lendRateBps);
    event DepositedToPool(address indexed user, address token, uint256 amount);
    event Withdrawn(address indexed user, address token, uint256 principalOut, uint256 interestOut, uint256 totalOut);
    event LoanRequested(address indexed user, address token, uint256 principal, uint256 rateBps);
    event LoanRepaid(address indexed user, address token, uint256 repayAmount, uint256 remainingDebt);
    event LoanRepaidFor(address indexed payer, address indexed borrower, address token, uint256 paid);
    event RewardDistributed(address indexed user, uint256 amount);
    event RewardsDistributorUpdated(address indexed distributor);

    constructor(address _collateralManager, address initialOwner) Ownable(initialOwner) {
        collateralManager = ICollateralManager(_collateralManager);
    }

    // ===== ADMIN =====
    function setPriceOracle(address _oracle) external onlyOwner { // <— NEW
        require(_oracle != address(0), "Invalid oracle");
        priceOracle = IPriceOracle(_oracle);
    }

    function supportToken(address token, uint256 borrowRateBps, uint256 lendRateBps) external onlyOwner {
        require(token != address(0), "Invalid token");
        require(borrowRateBps <= 10000 && lendRateBps <= 10000, "Rate too high");
        ratesByToken[token] = InterestRates(borrowRateBps, lendRateBps);
        if (!isSupportedToken[token]) {
            _supportedTokens.push(token);
            isSupportedToken[token] = true;
        }
        emit TokenSupported(token, borrowRateBps, lendRateBps);
    }

    function setRewardToken(address token) external onlyOwner {
        rewardToken = IERC20(token);
    }

    function setRewardsDistributor(address distributor) external onlyOwner {
        rewardsDistributor = IRewardsDistributor(distributor);
        emit RewardsDistributorUpdated(distributor);
    }

    // ===== LENDING (SUPPLY SIDE) =====

    /// @notice Người dùng gửi thanh khoản vào pool
    function depositToPool(address token, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount=0");
        require(isSupportedToken[token], "Unsupported token");

        // checkpoint lãi trước khi cộng thêm gốc mới
        Lender storage l = lenders[msg.sender][token];
        if (l.deposited > 0 && l.depositTime > 0) {
            uint256 accrued = _accrueLender(l.deposited, ratesByToken[token].lendRate, l.depositTime);
            if (accrued > 0) l.rewardClaimed += accrued;
        }

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        l.deposited += amount;
        l.depositTime = block.timestamp;

        treasury[token].totalDeposits += amount;
        emit DepositedToPool(msg.sender, token, amount);
        _notifyRewards(msg.sender);
    }

    /// @notice Lãi đang chờ của lender tính từ depositTime
    function calculateLenderReward(address user, address token) public view returns (uint256) {
        Lender memory l = lenders[user][token];
        if (l.deposited == 0 || l.depositTime == 0) return 0;

        uint256 accrued = _accrueLender(l.deposited, ratesByToken[token].lendRate, l.depositTime);
        return accrued > l.rewardClaimed ? (accrued - l.rewardClaimed) : 0;
    }

    /// @notice Rút gốc + lãi một phần (amount <= deposited) hoặc dùng MaxUint để rút all
    function withdraw(address token, uint256 amount) public nonReentrant {
        _withdraw(msg.sender, token, amount);
    }

    function _withdraw(address user, address token, uint256 amount) internal {
        Lender storage l = lenders[user][token];
        require(l.deposited > 0, "No deposit");

        uint256 prePrincipal = l.deposited;
        uint256 rewardNow = calculateLenderReward(user, token);

        if (amount == type(uint256).max) {
            uint256 totalOut = prePrincipal + rewardNow;

            // đảm bảo thanh khoản thực (thay vì chỉ nhìn treasury)
            require(IERC20(token).balanceOf(address(this)) >= totalOut, "Insufficient liquidity");

            // update state
            l.deposited = 0;
            l.depositTime = 0;
            l.rewardClaimed += rewardNow;

            if (treasury[token].totalDeposits >= prePrincipal) {
                treasury[token].totalDeposits -= prePrincipal;
            } else {
                treasury[token].totalDeposits = 0;
            }

            IERC20(token).safeTransfer(user, totalOut);
            _distributeReward(user, rewardNow / 10);

            emit Withdrawn(user, token, prePrincipal, rewardNow, totalOut);
            return;
        }

        require(amount > 0 && amount <= prePrincipal, "Invalid amount");

        // phần lãi trả tỉ lệ theo amount
        uint256 interestOut = prePrincipal > 0 ? (rewardNow * amount) / prePrincipal : 0;
        uint256 totalOutPartial = amount + interestOut;

        require(IERC20(token).balanceOf(address(this)) >= totalOutPartial, "Insufficient liquidity");

        // cập nhật state
        l.deposited = prePrincipal - amount;
        l.rewardClaimed += interestOut;      // ghi nhận phần lãi đã trả
        l.depositTime = block.timestamp;     // checkpoint cho phần còn lại

        if (treasury[token].totalDeposits >= amount) {
            treasury[token].totalDeposits -= amount;
        } else {
            treasury[token].totalDeposits = 0;
        }

        IERC20(token).safeTransfer(user, totalOutPartial);
        emit Withdrawn(user, token, amount, interestOut, totalOutPartial);
        _notifyRewards(user);
    }

    /// @notice Rút toàn bộ gốc + lãi (atomic convenience)
    function withdrawAll(address token) external nonReentrant {
        _withdraw(msg.sender, token, type(uint256).max);
    }

    // ===== BORROWING (DEBT SIDE) =====

    /// @notice Vay từ pool (đơn token). Yêu cầu có thanh khoản thực tế.
    function requestLoan(address token, uint256 principal, uint256 duration) external nonReentrant {
        require(!loans[msg.sender].active, "Loan active");
        require(principal > 0 && duration > 0, "Invalid input");
        require(isSupportedToken[token], "Unsupported token");

        uint256 rateBps = ratesByToken[token].borrowRate;
        require(rateBps > 0, "Borrow rate not set");

        // tài khoản phải khoẻ trước khi vay (HF >= 1)
        require(collateralManager.getHealthFactor(msg.sender) >= 1e18, "Unhealthy account");

        // phải có thanh khoản thực bằng token
        require(IERC20(token).balanceOf(address(this)) >= principal, "No liquidity");

        loans[msg.sender] = Loan({
            token: token,                 // <— NEW: lưu token đang vay
            principal: principal,
            rate: rateBps,
            totalInterest: 0,
            createdAt: block.timestamp,
            duration: duration,
            active: true
        });

        treasury[token].totalBorrows += principal;

        // track borrower (cho liquidator quét)
        if (!isBorrower[msg.sender]) {
            isBorrower[msg.sender] = true;
            activeBorrowers.push(msg.sender);
            activeBorrowerIndex[msg.sender] = activeBorrowers.length; // store index+1
        }

        IERC20(token).safeTransfer(msg.sender, principal);
        emit LoanRequested(msg.sender, token, principal, rateBps);
        _notifyRewards(msg.sender);
    }

    /// @notice Lãi phải trả tính từ createdAt
    function calculateInterest(address user) public view returns (uint256) {
        Loan memory loan = loans[user];
        if (!loan.active) return 0;
        uint256 elapsed = block.timestamp - loan.createdAt;
        return (loan.principal * loan.rate * elapsed) / (10000 * 365 days);
    }

    /// @notice Người vay tự trả nợ
    function repay(address token, uint256 amount) external nonReentrant {
        // Bảo vệ UI: yêu cầu đúng token đang vay (nếu đã lưu)
        address loanToken = loans[msg.sender].token;
        if (loanToken != address(0)) {
            require(token == loanToken, "Wrong token");
        }
        _repayInternal(msg.sender, msg.sender, token, amount);
    }

    /// @notice Trả thay (liquidator / bot / bạn bè trả hộ)
    function repayFor(address borrower, address token, uint256 amount) external nonReentrant {
        require(borrower != address(0), "Invalid borrower");
        address loanToken = loans[borrower].token;
        if (loanToken != address(0)) {
            require(token == loanToken, "Wrong token");
        }
        _repayInternal(msg.sender, borrower, token, amount);
        emit LoanRepaidFor(msg.sender, borrower, token, amount);
    }

    /// @notice Trả toàn bộ nợ (gốc + lãi) trong 1 tx
    function repayAll(address token) external nonReentrant {
        Loan memory loan = loans[msg.sender];
        require(loan.active, "No active loan");
        if (loan.token != address(0)) {
            require(token == loan.token, "Wrong token");
        }
        uint256 totalDebt = loan.principal + calculateInterest(msg.sender);
        _repayInternal(msg.sender, msg.sender, token, totalDebt);
    }

    function _repayInternal(address payer, address borrower, address token, uint256 amount) internal {
        Loan storage loan = loans[borrower];
        require(loan.active, "No active loan");
        require(amount > 0, "Amount=0");

        IERC20(token).safeTransferFrom(payer, address(this), amount);
        treasury[token].totalRepayments += amount;

        uint256 interest = calculateInterest(borrower);
        uint256 totalDebt = loan.principal + interest;
        if (amount > totalDebt) amount = totalDebt;

        uint256 remaining = amount;
        uint256 interestPaid;

        // 1) trả lãi trước
        if (remaining >= interest) {
            remaining -= interest;
            loan.totalInterest += interest;
            interestPaid = interest;
        } else {
            loan.totalInterest += remaining;
            interestPaid = remaining;
            remaining = 0;
        }

        if (interestPaid > 0) {
            uint256 borrowRateBps = loan.rate;
            uint256 lendRateBps = ratesByToken[token].lendRate;
            uint256 toLender = 0;
            if (borrowRateBps > 0 && lendRateBps > 0) {
                toLender = (interestPaid * lendRateBps) / borrowRateBps;
                if (toLender > interestPaid) {
                    toLender = interestPaid;
                }
            }
            uint256 toProtocol = interestPaid - toLender;

            if (toLender > 0) {
                treasury[token].totalDeposits += toLender;
            }
            if (toProtocol > 0) {
                protocolProfit[token] += toProtocol;
            }
        }

        // 2) trừ gốc
        if (remaining > 0) {
            if (remaining >= loan.principal) {
                loan.principal = 0;
            } else {
                loan.principal -= remaining;
            }
        }

        // 3) cập nhật mốc tính lãi
        loan.createdAt = block.timestamp;

        // 4) đóng loan nếu hết nợ
        if (loan.principal == 0) {
            loan.active = false;
            loan.token = address(0);
            if (isBorrower[borrower]) {
                isBorrower[borrower] = false;
                _removeActiveBorrower(borrower);
            }
            // chỉ thưởng nếu tự trả (tránh confusion khi repayFor)
            if (payer == borrower) {
                _distributeReward(borrower, interest / 10);
            }
        }

        uint256 remainingDebt = loan.active ? (loan.principal + calculateInterest(borrower)) : 0;
        emit LoanRepaid(borrower, token, amount, remainingDebt);
        _notifyRewards(borrower);
    }

    /// @notice Nợ hiện tại (gốc + lãi) theo đơn vị token gốc
    function getOutstandingLoan(address user) external view returns (uint256) {
        Loan memory loan = loans[user];
        if (!loan.active) return 0;
        return loan.principal + calculateInterest(user);
    }

    /// @notice NEW: Nợ quy USD (8 decimals) = (debtRaw * priceUSD8) / 10**decimals(token)
    function getOutstandingLoanUSD(address user) external view returns (uint256) { // <— NEW
        Loan memory loan = loans[user];
        if (!loan.active) return 0;
        require(address(priceOracle) != address(0), "Oracle not set");
        require(loan.token != address(0), "No loan token");
        uint256 debtRaw = loan.principal + calculateInterest(user);

        uint256 px = priceOracle.getPrice(loan.token); // 8 decimals
        uint8 dec = IERC20Metadata(loan.token).decimals();
        return (debtRaw * px) / (10 ** dec);
    }

    /// @notice NEW: trả về token đang vay (address(0) nếu chưa)
    function getLoanToken(address user) external view returns (address) { // <— NEW
        return loans[user].token;
    }

    /// @notice Thanh khoản thực có thể chi trả (debug/UI)
    function getAvailableLiquidity(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ===== LIQUIDATOR HELPERS (Phase 2) =====
    function getActiveBorrowers() external view returns (address[] memory) { // <— NEW
        return activeBorrowers;
    }

    function getActiveBorrowerCount() external view returns (uint256) { // <— NEW
        return activeBorrowers.length;
    }

    function withdrawProtocolProfit(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid target");
        require(amount > 0, "Amount=0");
        require(amount <= protocolProfit[token], "Exceeds profit");

        protocolProfit[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
    }

    function claimRewards() external nonReentrant {
        if (address(rewardsDistributor) == address(0)) {
            revert("Rewards disabled");
        }
        _notifyRewards(msg.sender);
        rewardsDistributor.claim(msg.sender);
    }

    // ===== INTERNAL =====
    function _accrueLender(uint256 principal, uint256 lendRateBps, uint256 fromTs) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - fromTs;
        return (principal * lendRateBps * elapsed) / (10000 * 365 days);
    }

    function _distributeReward(address user, uint256 amount) internal {
        if (address(rewardToken) != address(0) && amount > 0) {
            uint256 bal = rewardToken.balanceOf(address(this));
            if (bal >= amount) {
                rewardToken.safeTransfer(user, amount);
                emit RewardDistributed(user, amount);
            }
        }
    }

    function _removeActiveBorrower(address borrower) internal {
        uint256 indexPlusOne = activeBorrowerIndex[borrower];
        if (indexPlusOne == 0) {
            return;
        }

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = activeBorrowers.length - 1;

        if (index != lastIndex) {
            address lastBorrower = activeBorrowers[lastIndex];
            activeBorrowers[index] = lastBorrower;
            activeBorrowerIndex[lastBorrower] = index + 1;
        }

        activeBorrowers.pop();
        activeBorrowerIndex[borrower] = 0;
    }

    function _notifyRewards(address user) internal {
        if (address(rewardsDistributor) == address(0) || user == address(0)) {
            return;
        }

        uint256 usdSupplied = _getUserSuppliedUSD(user);
        uint256 usdBorrowed = _getUserBorrowedUSD(user);
        rewardsDistributor.onAction(user, usdSupplied, usdBorrowed);
    }

    function _getUserSuppliedUSD(address user) internal view returns (uint256 totalUSD) {
        if (address(priceOracle) == address(0) || _supportedTokens.length == 0) {
            return 0;
        }
        for (uint256 i = 0; i < _supportedTokens.length; i++) {
            address token = _supportedTokens[i];
            Lender memory l = lenders[user][token];
            if (l.deposited == 0) continue;
            uint256 price = priceOracle.getPrice(token);
            require(price > 0, "Bad price");
            uint8 decimals = IERC20Metadata(token).decimals();
            totalUSD += (l.deposited * price) / (10 ** decimals);
        }
    }

    function _getUserBorrowedUSD(address user) internal view returns (uint256) {
        if (address(priceOracle) == address(0)) {
            return 0;
        }
        Loan memory loan = loans[user];
        if (!loan.active || loan.token == address(0)) {
            return 0;
        }
        uint256 debtRaw = loan.principal + calculateInterest(user);
        uint256 px = priceOracle.getPrice(loan.token);
        if (px == 0) {
            return 0;
        }
        uint8 dec = IERC20Metadata(loan.token).decimals();
        return (debtRaw * px) / (10 ** dec);
    }

    address[] private _supportedTokens;
}
