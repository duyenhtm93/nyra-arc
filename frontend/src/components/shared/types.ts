// Shared TypeScript interfaces for components

export interface TabItem {
  id: string;
  label: string;
  path: string;
  icon?: string;
}

export interface TokenInfo {
  tokenAddress: string;
  symbol: string;
  icon: string;
  name: string;
}

export interface TokenWithBalance extends TokenInfo {
  balance: number;
  isLoading: boolean;
  error?: any;
}

export interface TokenWithAmount extends TokenInfo {
  amount: number;
}

export interface TokenWithDebt extends TokenInfo {
  principal: number;
  interestOwed: number;
  totalDebt: number;
  rate: number;
  rawPrincipal: bigint;
  rawTotalDebt: bigint;
}

export interface CollateralInfo extends TokenInfo {
  amount: number;
  ltv?: number;
}

export interface MarketData extends TokenInfo {
  price: number;
  totalSupplied: number;
  totalBorrowed: number;
  lendRate: number;
  borrowRate: number;
  utilization: number;
  isLoading: boolean;
  error?: any;
}

export interface HealthFactor {
  healthFactor: number;
  isLoading: boolean;
}

export interface UserBorrows {
  borrows: TokenWithDebt[];
  healthFactor: HealthFactor;
  supportedTokens: TokenInfo[];
  isLoading: boolean;
}

export interface UserSupplies {
  supplies: TokenWithAmount[];
  isLoading: boolean;
}

export interface WalletBalances {
  walletBalances: TokenWithBalance[];
  isLoading: boolean;
}

export interface CollateralDetails {
  totalCollateralValue: number;
  healthFactor: number;
  outstandingLoan: number;
  availableToBorrow: number;
  isLoading: boolean;
}

export interface SupplyRates {
  lendRate: number;
  isLoading: boolean;
}

export interface BorrowRates {
  borrowRate: number;
  isLoading: boolean;
}

export interface AvailableToBorrow {
  available: number;
  isLoading: boolean;
}

export interface LoanToRepay extends TokenInfo {
  principal: number;
  interestOwed: number;
  totalDebt: number;
  rawPrincipal: bigint;
  rawTotalDebt: bigint;
}

// Modal Props Interfaces
export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface LoanRepaymentModalProps extends ModalProps {
  loanToRepay: LoanToRepay;
  formatBalance: (amount: number) => string;
}

export interface CollateralManagementModalProps extends ModalProps {
  collateral: CollateralInfo;
  formatBalance: (amount: number) => string;
  onTransactionSuccess?: () => void;
}

// Row Component Props Interfaces
export interface AssetRowProps {
  formatBalance: (amount: number) => string;
}

export interface BorrowableAssetRowProps extends AssetRowProps {
  token: TokenInfo;
}

export interface SupplyableAssetRowProps extends AssetRowProps {
  asset: TokenWithBalance;
}

export interface SupplyManagementRowProps extends AssetRowProps {
  supply: TokenWithAmount;
  walletBalance: number;
}

export interface CollateralAssetRowProps extends AssetRowProps {
  token: TokenWithBalance;
}

// Navigation Props
export interface NavigationTabsProps {
  tabs: TabItem[];
  className?: string;
}

// Utility Types
export type FormatBalanceFunction = (amount: number) => string;
export type TransactionSuccessCallback = () => void;
