"use client";

import { useState, useEffect, useRef } from "react";
import { useRepayLoan } from "@/hooks/useRepayLoan";
import { formatUnits, parseUnits, encodeFunctionData } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useTokenBalance } from "@/hooks/useCollateral";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { useCollateralDetails } from "@/hooks/useCollateral";
import { useMarketData } from "@/hooks/useMarketData";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

interface LoanRepaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  loanToRepay: {
    tokenAddress: string;
    symbol: string;
    icon: string;
    name: string;
    principal: number;
    interestOwed: number;
    totalDebt: number;
    rawPrincipal: bigint;
    rawTotalDebt: bigint;
  };
  formatBalance: (amount: number) => string;
  onTransactionSuccess?: () => void;
}

export default function LoanRepaymentModal({ 
  isOpen, 
  onClose, 
  loanToRepay, 
  formatBalance,
  onTransactionSuccess
}: LoanRepaymentModalProps) {
  const [amount, setAmount] = useState("");
  const [isRepaying, setIsRepaying] = useState(false);
  const [isRepayAll, setIsRepayAll] = useState(false);
  const [usingPrivyFlow, setUsingPrivyFlow] = useState(false);
  
  const repayCalledRef = useRef(false);
  
  const { repayLoanAmount, repayAllLoan } = useRepayLoan();
  const { address, isConnected } = useAccount();
  const { wallets } = useWallets();
  
  const isWalletConnected = isConnected || wallets.length > 0;
  const walletAddress = address || wallets[0]?.address;
  
  const collateralDetails = useCollateralDetails(walletAddress);
  const marketData = useMarketData();
  const toast = useToast();
  
  // Get token price from market data
  const getTokenPrice = (tokenAddress: string) => {
    const market = marketData.find(m => m.tokenAddress === tokenAddress);
    return market?.price || 1.00;
  };
  
  // Calculate projected health factor after repayment
  const calculateProjectedHealthFactor = () => {
    if (!collateralDetails.healthFactor) return null;
    
    // If repay all, health factor will be infinite (no debt)
    if (isRepayAll) return 999;
    
    if (!amount) return null;
    
    // Amount is in token units (repayment amount)
    const repayAmount = parseFloat(amount);
    const tokenPrice = getTokenPrice(loanToRepay.tokenAddress);
    const repayAmountUSD = repayAmount * tokenPrice;
    
    // Use current health factor and calculate new one after repayment
    const currentHealthFactor = collateralDetails.healthFactor;
    
    // After repayment, debt decreases, so health factor increases
    // Simplified calculation: if we repay X USD, new health factor = current * (totalDebt / (totalDebt - X))
    const currentDebtUSD = loanToRepay.totalDebt * tokenPrice;
    const newDebtUSD = Math.max(0, currentDebtUSD - repayAmountUSD);
    
    const projectedHealthFactor = newDebtUSD > 0 ? (currentHealthFactor * currentDebtUSD) / newDebtUSD : 999;
    
    return projectedHealthFactor;
  };
  
  const projectedHealthFactor = calculateProjectedHealthFactor();
  
  // Kiểm tra balance của user
  const { balance: userBalance, isLoading: balanceLoading } = useTokenBalance(
    loanToRepay?.tokenAddress || "", 
    walletAddress
  );

  // Hook để gọi getOutstandingLoan khi cần
  const { refetch: getOutstandingLoan } = useReadContract({
    address: getAddress("LoanManager"),
    abi: [
      {
        name: "getOutstandingLoan",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "user", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "getOutstandingLoan",
    args: walletAddress ? [walletAddress as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: false, // Chỉ gọi khi cần thiết
    },
  });

  // Helper function để repay all với Privy wallet
  const handleRepayAllWithPrivy = async (): Promise<string> => {
    const privyWallet = wallets[0];
    await privyWallet.switchChain(ARC_CHAIN_ID);
    
    const provider = await privyWallet.getEthereumProvider();
    const tokenInfo = getTokenInfo(loanToRepay.tokenAddress);
    
    // Thêm buffer 0.5% để đảm bảo đủ cho lãi phát sinh
    const buffer = (loanToRepay.rawTotalDebt * BigInt(1005)) / BigInt(1000);
    
    // Step 1: Approve
    const approveData = encodeFunctionData({
      abi: [{
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }],
      }],
      functionName: "approve",
      args: [getAddress("LoanManager"), buffer],
    });

    const approveTxHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddress,
        to: loanToRepay.tokenAddress,
        data: approveData,
      }]
    });

    // Wait for approve
    await waitForTxConfirmation(provider, approveTxHash);
    
    // Step 2: RepayAll
    const repayAllData = encodeFunctionData({
      abi: [{
        name: "repayAll",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "token", type: "address" }],
        outputs: [],
      }],
      functionName: "repayAll",
      args: [loanToRepay.tokenAddress as `0x${string}`],
    });

    const repayTxHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddress,
      to: getAddress("LoanManager"),
        data: repayAllData,
      }]
    });

    // Wait for repay
    await waitForTxConfirmation(provider, repayTxHash);
    
    // Wait for contract state to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return repayTxHash;
  };

  // Helper để repay amount với Privy
  const handleRepayWithPrivy = async (repayAmount: number): Promise<string> => {
    const privyWallet = wallets[0];
    await privyWallet.switchChain(ARC_CHAIN_ID);
    
    const provider = await privyWallet.getEthereumProvider();
    const tokenInfo = getTokenInfo(loanToRepay.tokenAddress);
    const amountWei = parseUnits(repayAmount.toString(), tokenInfo.decimals);
    
    // Step 1: Approve
    const approveData = encodeFunctionData({
      abi: [{
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }],
      }],
      functionName: "approve",
      args: [getAddress("LoanManager"), amountWei],
    });

    const approveTxHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddress,
        to: loanToRepay.tokenAddress,
        data: approveData,
      }]
    });

    await waitForTxConfirmation(provider, approveTxHash);
    
    // Step 2: Repay
    const repayData = encodeFunctionData({
      abi: [{
        name: "repay",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" }
        ],
        outputs: [],
      }],
      functionName: "repay",
      args: [loanToRepay.tokenAddress as `0x${string}`, amountWei],
    });

    const repayTxHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: walletAddress,
      to: getAddress("LoanManager"),
        data: repayData,
      }]
    });

    await waitForTxConfirmation(provider, repayTxHash);
    
    // Wait for contract state to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return repayTxHash;
  };

  // Helper để wait for transaction confirmation
  const waitForTxConfirmation = async (provider: any, txHash: string) => {
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      try {
        const receipt = await provider.request({
          method: "eth_getTransactionReceipt",
          params: [txHash]
        });
        
        if (receipt && receipt.status) {
          return receipt;
        }
      } catch (e) {}
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error("Transaction timeout after 30s");
  };

  const handleRepayAll = async () => {
    if (!loanToRepay) {
      toast.showError("No loan to repay");
      return;
    }

    // Kiểm tra balance
    if (userBalance < loanToRepay.totalDebt) {
      toast.showError(
        "Insufficient balance", 
        `You have ${formatBalance(userBalance)} ${loanToRepay.symbol}, but need ${formatBalance(loanToRepay.totalDebt)} ${loanToRepay.symbol} to repay all.`
      );
      return;
    }

    setIsRepaying(true);
    
    // Only show loading toast when we start the actual transaction
    let loadingToast: string | number | null = null;
    
    try {
      // Show loading toast when we start the actual transaction
      loadingToast = toast.showTransactionPending("Repay All Loan");
      let txHash: string;
      
      if (!isConnected && wallets.length > 0) {
        setUsingPrivyFlow(true);
        // Dùng Privy wallet - flow approve + repayAll
        txHash = await handleRepayAllWithPrivy();
      } else {
        // Dùng wagmi hook
        txHash = await repayAllLoan(loanToRepay.tokenAddress);
        
        // Wait for contract state to update
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Dismiss loading toast
      if (loadingToast !== null) {
        toast.dismiss(loadingToast);
      }
      
      // Show success toast
      toast.showTransactionSuccess(txHash, "Repay All");
      
      if (onTransactionSuccess) {
        onTransactionSuccess();
      }
      
      setTimeout(() => {
        handleClose();
      }, 500);
    } catch (error) {
      console.error("Repay All failed:", error);
      if (loadingToast !== null) {
        toast.dismiss(loadingToast);
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Unknown error', 
        "Repay All"
      );
      setUsingPrivyFlow(false);
    } finally {
      setIsRepaying(false);
    }
  };

  const handleRepay = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.showError("Please enter a valid amount");
      return;
    }

    if (parseFloat(amount) > loanToRepay.totalDebt) {
      toast.showError("Amount cannot exceed total debt");
      return;
    }

    // Kiểm tra balance
    if (userBalance < parseFloat(amount)) {
      toast.showError(
        "Insufficient balance",
        `You have ${formatBalance(userBalance)} ${loanToRepay.symbol}, but trying to repay ${amount} ${loanToRepay.symbol}`
      );
      return;
    }

    setIsRepaying(true);
    
    // Only show loading toast when we start the actual transaction
    let loadingToast: string | number | null = null;
    
    try {
      // Show loading toast when we start the actual transaction
      loadingToast = toast.showTransactionPending("Repay Loan");
      // Nếu user đang trả max amount, gọi contract để lấy exact current amount
      let repayAmount = parseFloat(amount);
      
      if (parseFloat(amount) >= loanToRepay.totalDebt * 0.99) { // Nếu trả gần như toàn bộ
        const { data: currentOutstanding } = await getOutstandingLoan();
        if (currentOutstanding) {
          const tokenInfo = getTokenInfo(loanToRepay.tokenAddress);
          const exactAmount = parseFloat(formatUnits(currentOutstanding, tokenInfo.decimals));
          
          // Nếu exact amount nhỏ hơn balance, dùng exact amount
          if (exactAmount <= userBalance) {
            repayAmount = exactAmount;
          }
        }
      }

      let txHash: string;
      
      if (!isConnected && wallets.length > 0) {
        setUsingPrivyFlow(true);
        txHash = await handleRepayWithPrivy(repayAmount);
      } else {
        txHash = await repayLoanAmount(loanToRepay.tokenAddress, repayAmount);
        
        // Wait for contract state to update
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Dismiss loading toast
      if (loadingToast !== null) {
        toast.dismiss(loadingToast);
      }
      
      // Show success toast
      toast.showTransactionSuccess(txHash, "Repay Loan");
      
      if (onTransactionSuccess) {
        onTransactionSuccess();
      }
      
      setTimeout(() => {
        handleClose();
      }, 500);
    } catch (error) {
      console.error("Repay failed:", error);
      if (loadingToast !== null) {
        toast.dismiss(loadingToast);
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Unknown error',
        "Repay Loan"
      );
      setUsingPrivyFlow(false);
    } finally {
      setIsRepaying(false);
    }
  };

  const handleMaxAmount = async () => {
    try {
      // Gọi contract để lấy exact outstanding loan amount tại thời điểm hiện tại
      
      const { data: outstandingLoan } = await getOutstandingLoan();
      
      if (outstandingLoan) {
        const tokenInfo = getTokenInfo(loanToRepay.tokenAddress);
        const maxAmount = parseFloat(formatUnits(outstandingLoan, tokenInfo.decimals));
        
        setAmount(maxAmount.toString());
      } else {
        console.warn("⚠️ No outstanding loan data, using cached value");
        setAmount(loanToRepay.totalDebt.toString());
      }
    } catch (error) {
      console.error("❌ Error getting max amount:", error);
      // Fallback to cached value
      setAmount(loanToRepay.totalDebt.toString());
    }
  };

  const handlePartialAmount = () => {
    setAmount(loanToRepay.principal.toString());
  };

  const handleClose = () => {
    setAmount("");
    setIsRepayAll(false);
    setUsingPrivyFlow(false);
    repayCalledRef.current = false;
    onClose();
  };

  if (!isOpen) {
    return null;
  }


  return (
    <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="rounded-lg p-6 w-[25.9rem] max-w-[25.9rem] mx-4 border border-gray-600" style={{backgroundColor: 'var(--background)'}}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white">
            Repay {loanToRepay.symbol} Loan
          </h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white text-xl font-bold"
          >
            ✕
          </button>
        </div>

        {/* Loan Info */}
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-sm" style={{color: 'var(--text-secondary)'}}>Amount</label>
            </div>
            
            <div className="relative rounded-lg p-3 border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    disabled={isRepayAll}
                    className="w-full text-2xl font-semibold text-white bg-transparent border-none outline-none placeholder-gray-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <img 
                    src={loanToRepay.icon} 
                    alt={loanToRepay.symbol}
                    className="w-8 h-8"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const nextElement = e.currentTarget.nextElementSibling as HTMLElement;
                      if (nextElement) {
                        nextElement.style.display = 'flex';
                      }
                    }}
                  />
                  <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center hidden">
                    <span className="text-xs font-bold text-gray-800">{loanToRepay.symbol.charAt(0)}</span>
                  </div>
                  <span className="font-semibold text-gray-300">{loanToRepay.symbol}</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between mt-3">
                <div className="text-xs text-gray-400">
                  ${(parseFloat(amount || "0") * 1).toFixed(2)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    Wallet balance {balanceLoading ? "Loading..." : formatBalance(userBalance)}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setAmount(formatBalance(loanToRepay.totalDebt));
                        setIsRepayAll(true);
                      }}
                      className="text-xs font-semibold text-gray-300 hover:text-white"
                    >
                      MAX
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>


          {/* Risk Information */}
          <h4 className="text-sm mb-1" style={{color: 'var(--text-secondary)'}}>Risk Information</h4>
          <div className="p-3 rounded-lg text-base border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
            <div className="flex justify-between mb-1">
              <span className="text-gray-300">Borrowed:</span>
              <span className="text-white">{loanToRepay.principal.toFixed(2)} {loanToRepay.symbol}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-gray-300">Current Health factor:</span>
              <span className="text-white">
                {collateralDetails.isLoading ? "..." : 
                 projectedHealthFactor ? 
                 `${collateralDetails.healthFactor.toFixed(2)} > ` :
                 collateralDetails.healthFactor.toFixed(2)}
                {projectedHealthFactor && (
                  <span className={`${projectedHealthFactor >= 1.5 ? 'text-green-400' : projectedHealthFactor >= 1.1 ? 'text-orange-400' : 'text-red-400'}`}>
                    {projectedHealthFactor >= 999 ? '∞' : projectedHealthFactor.toFixed(2)}
                  </span>
                )}
              </span>
            </div>
            <div className="text-right text-xs">
              <span className="text-gray-300">Liquidation at: </span>
              <span className="text-white">&lt;1.0</span>
            </div>
          </div>

          <button
            onClick={isRepayAll ? handleRepayAll : handleRepay}
            disabled={
              isRepayAll 
                ? (isRepaying || userBalance < loanToRepay.totalDebt)
                : (isRepaying || !amount || parseFloat(amount) <= 0)
            }
            className="w-full px-4 py-2 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors border border-gray-600 mt-8"
            style={{backgroundColor: 'var(--button-danger)'}}
            onMouseEnter={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.backgroundColor = 'var(--button-danger-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.backgroundColor = 'var(--button-danger)';
              }
            }}
          >
            {isRepaying 
              ? "Repaying..." 
              : isRepayAll 
                ? `Repay All ${loanToRepay.symbol}` 
                : `Repay ${loanToRepay.symbol}`
            }
          </button>
        </div>
      </div>
    </div>
  );
}
