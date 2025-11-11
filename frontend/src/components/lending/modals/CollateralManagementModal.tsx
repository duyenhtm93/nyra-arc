"use client";

import { useState, useEffect, useRef } from "react";
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { parseUnits, formatUnits, encodeFunctionData } from "viem";
import { getTokenInfo } from "@/utils/tokenInfo";
import { useMarketData } from "@/hooks/useMarketData";
import { useWalletBalances, useCollateralDetails } from "@/hooks/useCollateral";
import { useInvalidateQueries } from "@/hooks/useInvalidateQueries";
import { useToast } from "@/hooks/useToast";
import { ARC_CHAIN_ID, getAddress } from "@/utils/addresses";

interface CollateralManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  collateral: {
    tokenAddress: string;
    symbol: string;
    icon: string;
    name: string;
    amount: number;
    ltv?: number;
  };
  formatBalance: (amount: number) => string;
  onTransactionSuccess?: () => void;
}

export default function CollateralManagementModal({ 
  isOpen, 
  onClose, 
  collateral, 
  formatBalance,
  onTransactionSuccess 
}: CollateralManagementModalProps) {
  const [action, setAction] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [usingPrivyFlow, setUsingPrivyFlow] = useState(false);
  
  const depositCalledRef = useRef(false);
  const currentLoadingToastRef = useRef<string | number | null>(null);
  const successToastShownRef = useRef(false);
  const toast = useToast();

  const tokenInfo = getTokenInfo(collateral.tokenAddress);
  const marketData = useMarketData();
  const { address, isConnected } = useAccount();
  const { wallets } = useWallets();
  
  // ✅ Fallback: nếu wagmi chưa sync thì lấy từ Privy
  const isWalletConnected = isConnected || wallets.length > 0;
  const walletAddress = address || wallets[0]?.address;
  
  const { invalidateAllUserData } = useInvalidateQueries();
  const { balances } = useWalletBalances(walletAddress);
  const collateralDetails = useCollateralDetails(walletAddress);

  // Get token price from market data
  const getTokenPrice = (tokenAddress: string) => {
    const market = marketData.find(m => m.tokenAddress === tokenAddress);
    return market?.price || 1.00;
  };

  // Calculate projected health factor after deposit/withdraw
  const calculateProjectedHealthFactor = () => {
    if (!amount || !collateralDetails.healthFactor) return null;
    
    // Lấy dữ liệu từ useCollateralDetails (đã có logic đúng)
    const collateralUSD = collateralDetails.totalCollateralValue || 0;
    const currentDebtUSD = collateralDetails.outstandingLoan || 0;
    const currentHealthFactor = collateralDetails.healthFactor;
    
    // Tính toán dựa trên tỷ lệ thay đổi
    // Nếu withdraw: newCollateral = currentCollateral * (1 - withdrawRatio)
    // Nếu deposit: newCollateral = currentCollateral + depositAmount
    
    let newCollateralUSD;
    if (action === 'deposit') {
      // Deposit: cộng thêm giá trị
      const transactionAmount = parseFloat(amount);
      const tokenPrice = getTokenPrice(collateral.tokenAddress);
      const transactionAmountUSD = transactionAmount * tokenPrice;
      newCollateralUSD = collateralUSD + transactionAmountUSD;
    } else {
      // Withdraw: tính theo tỷ lệ
      const withdrawAmount = parseFloat(amount);
      const tokenPrice = getTokenPrice(collateral.tokenAddress);
      const withdrawAmountUSD = withdrawAmount * tokenPrice;
      newCollateralUSD = Math.max(0, collateralUSD - withdrawAmountUSD);
    }
    
    // Sử dụng cùng logic như useCollateralDetails
    const maxLTV = 0.75; // 75% LTV
    const projectedHealthFactor = currentDebtUSD > 0 ? (newCollateralUSD * maxLTV) / currentDebtUSD : 999;
    
    // Không trả về 0 - trả về null thay vì 0 để không render ra "0"
    if (projectedHealthFactor <= 0) return null;
    
    return projectedHealthFactor;
  };

  // Get wallet balance for this token
  const getWalletBalance = () => {
    const walletBalance = balances.find(b => b.tokenAddress === collateral.tokenAddress);
    return walletBalance?.balance || 0;
  };

  // Calculate max safe withdraw amount (keep HF >= 1.2)
  const getMaxSafeWithdraw = () => {
    const currentCollateralUSD = collateralDetails.totalCollateralValue || 0;
    const debtUSD = collateralDetails.outstandingLoan || 0;
    const currentHF = collateralDetails.healthFactor || 0;

    // Nếu không có debt, có thể rút hết
    if (debtUSD === 0) {
      return collateral.amount;
    }

    // Tính weighted threshold từ current health factor
    // currentHF = (currentCollateralUSD × threshold) / debtUSD
    // threshold = (currentHF × debtUSD) / currentCollateralUSD
    const weightedThreshold = currentCollateralUSD > 0 
      ? (currentHF * debtUSD) / currentCollateralUSD 
      : 0.75;

    // Tính collateral USD cần thiết để maintain HF >= 1.2
    const targetHF = 1.2;
    const minCollateralUSD = (debtUSD * targetHF) / weightedThreshold;

    // Max có thể withdraw (USD)
    const maxWithdrawUSD = Math.max(0, currentCollateralUSD - minCollateralUSD);

    // Convert sang token amount
    const tokenPrice = getTokenPrice(collateral.tokenAddress);
    const maxWithdrawToken = tokenPrice > 0 ? maxWithdrawUSD / tokenPrice : 0;

    // Không được vượt quá collateral balance hiện tại
    return Math.min(maxWithdrawToken, collateral.amount);
  };

  const projectedHealthFactor = calculateProjectedHealthFactor();
  const maxSafeWithdraw = getMaxSafeWithdraw();

  // Contract writes
  const { writeContract: writeCollateral, data: collateralHash } = useWriteContract();
  const { writeContract: writeToken, data: approveHash } = useWriteContract();

  // Transaction receipts
  const { isLoading: isCollateralPending, isSuccess: isCollateralSuccess } = useWaitForTransactionReceipt({
    hash: collateralHash,
  });

  const { isLoading: isApprovePending, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  const isLoading = isCollateralPending || isApprovePending;

  // Auto-refresh data when transaction succeeds (wagmi flow only)
  useEffect(() => {
    if (isCollateralSuccess && walletAddress && !usingPrivyFlow && !successToastShownRef.current) {
      // Dismiss loading toast before showing success
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      
      successToastShownRef.current = true;
      toast.showTransactionSuccess(collateralHash!, "Deposit Collateral");
      if (onTransactionSuccess) {
        onTransactionSuccess();
      }
      setTimeout(() => {
        handleClose();
      }, 500);
    }
  }, [isCollateralSuccess, walletAddress, usingPrivyFlow, onTransactionSuccess, collateralHash]);

  // Handle approve success (wagmi flow only)
  useEffect(() => {
    if (isApproveSuccess && isApproving && !usingPrivyFlow && !successToastShownRef.current) {
      // Dismiss loading toast before showing success
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      
      successToastShownRef.current = true;
      toast.showTransactionSuccess(approveHash!, "Approve Token");
      setIsApproving(false);
      handleDepositAfterApproval();
    }
  }, [isApproveSuccess, isApproving, usingPrivyFlow, approveHash]);

  const handleDepositAfterApproval = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    
    if (depositCalledRef.current) {
      return;
    }

    depositCalledRef.current = true;
    currentLoadingToastRef.current = toast.showTransactionPending("Deposit Collateral");
    successToastShownRef.current = false; // Reset flag for new transaction

    try{
      const amountWei = parseUnits(amount, tokenInfo.decimals);
      
      if (!isConnected && wallets.length > 0) {
        const privyWallet = wallets[0];
        
        const depositData = encodeFunctionData({
          abi: [{
            name: "deposit",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: [],
          }],
          functionName: "deposit",
          args: [collateral.tokenAddress as `0x${string}`, amountWei],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: getAddress("CollateralManager"),
            data: depositData,
          }]
        });

        // Wait for confirmation
        try {
          let attempts = 0;
          const maxAttempts = 30;
          
          while (attempts < maxAttempts) {
            try {
              const receipt = await provider.request({
                method: "eth_getTransactionReceipt",
                params: [txHash]
              });
              
              if (receipt && receipt.status) {
                if (currentLoadingToastRef.current) {
                  toast.dismiss(currentLoadingToastRef.current);
                  currentLoadingToastRef.current = null;
                }
                successToastShownRef.current = true;
                toast.showTransactionSuccess(txHash, "Deposit Collateral");
                
                if (onTransactionSuccess) {
                  onTransactionSuccess();
                }
                
                setTimeout(() => {
                  handleClose();
                }, 500);
                break;
              }
            } catch (e) {}
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }
          
          if (attempts >= maxAttempts) {
            if (currentLoadingToastRef.current) {
              toast.dismiss(currentLoadingToastRef.current);
              currentLoadingToastRef.current = null;
            }
            depositCalledRef.current = false;
          }
        } catch (waitError) {
          console.error("Error waiting for deposit tx:", waitError);
          if (currentLoadingToastRef.current) {
            toast.dismiss(currentLoadingToastRef.current);
            currentLoadingToastRef.current = null;
          }
          toast.showTransactionError(
            waitError instanceof Error ? waitError.message : 'Transaction failed. Please try again.',
            "Deposit Collateral"
          );
          depositCalledRef.current = false;
        }
      } else {
        writeCollateral({
          address: getAddress("CollateralManager"),
          abi: [
            {
              name: "deposit",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint256" }
              ],
              outputs: [],
            },
          ],
          functionName: "deposit",
          args: [
            collateral.tokenAddress as `0x${string}`,
            amountWei
          ],
        });
      }
    } catch (error) {
      console.error("Error depositing collateral after approval:", error);
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Deposit failed. Please try again.',
        "Deposit Collateral"
      );
      depositCalledRef.current = false;
    }
  };

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) return;

    depositCalledRef.current = false;
    setIsApproving(true);
    currentLoadingToastRef.current = toast.showTransactionPending("Approve Token");
    successToastShownRef.current = false; // Reset flag for new transaction
    
    try {
      const amountWei = parseUnits(amount, tokenInfo.decimals);
      
      if (!isConnected && wallets.length > 0) {
        setUsingPrivyFlow(true);
        const privyWallet = wallets[0];
        
        await privyWallet.switchChain(ARC_CHAIN_ID);
        
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
          args: [getAddress("CollateralManager"), amountWei],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: collateral.tokenAddress,
            data: approveData,
          }]
        });

        // Wait for approve confirmation
        try {
          let attempts = 0;
          const maxAttempts = 30;
          
          while (attempts < maxAttempts) {
            try {
              const receipt = await provider.request({
                method: "eth_getTransactionReceipt",
                params: [txHash]
              });
              
              if (receipt && receipt.status) {
                if (currentLoadingToastRef.current) {
                  toast.dismiss(currentLoadingToastRef.current);
                  currentLoadingToastRef.current = null;
                }
                successToastShownRef.current = true;
                toast.showTransactionSuccess(txHash, "Approve Token");
                
                setIsApproving(false);
                await new Promise(resolve => setTimeout(resolve, 100));
                await handleDepositAfterApproval();
                break;
              }
            } catch (e) {}
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }
          
          if (attempts >= maxAttempts) {
            if (currentLoadingToastRef.current) {
              toast.dismiss(currentLoadingToastRef.current);
              currentLoadingToastRef.current = null;
            }
            setIsApproving(false);
            await handleDepositAfterApproval();
          }
        } catch (waitError) {
          console.error("Error waiting for approve tx:", waitError);
          if (currentLoadingToastRef.current) {
            toast.dismiss(currentLoadingToastRef.current);
            currentLoadingToastRef.current = null;
          }
          toast.showTransactionError(
            waitError instanceof Error ? waitError.message : 'Transaction failed. Please try again.',
            "Approve Token"
          );
          setIsApproving(false);
          setUsingPrivyFlow(false);
          depositCalledRef.current = false;
        }
      } else {
        writeToken({
          address: collateral.tokenAddress as `0x${string}`,
          abi: [
            {
              name: "approve",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "spender", type: "address" },
                { name: "amount", type: "uint256" }
              ],
              outputs: [{ name: "", type: "bool" }],
            },
          ],
          functionName: "approve",
          args: [
            getAddress("CollateralManager"),
            amountWei
          ],
        });
      }
    } catch (error) {
      console.error("Error approving token:", error);
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Approve failed. Please try again.',
        "Approve Token"
      );
      setIsApproving(false);
      setUsingPrivyFlow(false);
      depositCalledRef.current = false;
    }
  };

  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) return;

    currentLoadingToastRef.current = toast.showTransactionPending("Withdraw Collateral");
    successToastShownRef.current = false; // Reset flag for new transaction
    
    try {
      const amountWei = parseUnits(amount, tokenInfo.decimals);
      
      if (!isConnected && wallets.length > 0) {
        setUsingPrivyFlow(true);
        const privyWallet = wallets[0];
        
        await privyWallet.switchChain(ARC_CHAIN_ID);
        
        const withdrawData = encodeFunctionData({
          abi: [{
            name: "withdraw",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" }
            ],
            outputs: [],
          }],
          functionName: "withdraw",
          args: [collateral.tokenAddress as `0x${string}`, amountWei],
        });

        const provider = await privyWallet.getEthereumProvider();
        const txHash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: walletAddress,
            to: getAddress("CollateralManager"),
            data: withdrawData,
          }]
        });

        // Wait for confirmation
        try {
          let attempts = 0;
          const maxAttempts = 30;
          
          while (attempts < maxAttempts) {
            try {
              const receipt = await provider.request({
                method: "eth_getTransactionReceipt",
                params: [txHash]
              });
              
              if (receipt && receipt.status) {
                if (currentLoadingToastRef.current) {
                  toast.dismiss(currentLoadingToastRef.current);
                  currentLoadingToastRef.current = null;
                }
                successToastShownRef.current = true;
                toast.showTransactionSuccess(txHash, "Withdraw Collateral");
                
                if (onTransactionSuccess) {
                  onTransactionSuccess();
                }
                
                setTimeout(() => {
                  handleClose();
                }, 500);
                break;
              }
            } catch (e) {}
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          }
          
          if (attempts >= maxAttempts) {
            if (currentLoadingToastRef.current) {
              toast.dismiss(currentLoadingToastRef.current);
              currentLoadingToastRef.current = null;
            }
            setUsingPrivyFlow(false);
          }
        } catch (waitError) {
          console.error("Error waiting for withdraw tx:", waitError);
          if (currentLoadingToastRef.current) {
            toast.dismiss(currentLoadingToastRef.current);
            currentLoadingToastRef.current = null;
          }
          toast.showTransactionError(
            waitError instanceof Error ? waitError.message : 'Transaction failed. Please try again.',
            "Withdraw Collateral"
          );
          setUsingPrivyFlow(false);
        }
      } else {
        writeCollateral({
          address: getAddress("CollateralManager"),
          abi: [
            {
              name: "withdraw",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint256" }
              ],
              outputs: [],
            },
          ],
          functionName: "withdraw",
          args: [
            collateral.tokenAddress as `0x${string}`,
            amountWei
          ],
        });
      }
    } catch (error) {
      console.error("Error withdrawing collateral:", error);
      if (currentLoadingToastRef.current) {
        toast.dismiss(currentLoadingToastRef.current);
        currentLoadingToastRef.current = null;
      }
      toast.showTransactionError(
        error instanceof Error ? error.message : 'Withdraw failed. Please try again.',
        "Withdraw Collateral"
      );
      setUsingPrivyFlow(false);
    }
  };

  const handleSubmit = () => {
    if (action === 'deposit') {
      handleDeposit();
    } else {
      handleWithdraw();
    }
  };

  const handleClose = () => {
    setAmount('');
    setAction('deposit');
    setIsApproving(false);
    setUsingPrivyFlow(false);
    depositCalledRef.current = false;
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50">
      <div 
        className="rounded-lg p-6 w-[25.9rem] max-w-[25.9rem] mx-4 border border-gray-600"
        style={{backgroundColor: 'var(--background)'}}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white">
            Manage {collateral.symbol} Collateral
          </h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white text-xl font-bold"
          >
            ✕
          </button>
        </div>

        {/* Action Toggle */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setAction('deposit')}
            className={`flex-1 py-2 px-4 rounded-lg text-base font-medium transition-colors border border-gray-600 ${
              action === 'deposit'
                ? 'text-white'
                : 'text-gray-300 hover:text-white'
            }`}
            style={action === 'deposit' ? {backgroundColor: 'var(--button-active)'} : {}}
          >
            Deposit
          </button>
          <button
            onClick={() => setAction('withdraw')}
            className={`flex-1 py-2 px-4 rounded-lg text-base font-medium transition-colors border border-gray-600 ${
              action === 'withdraw'
                ? 'text-white'
                : 'text-gray-300 hover:text-white'
            }`}
            style={action === 'withdraw' ? {backgroundColor: 'var(--button-danger)'} : {}}
          >
            Withdraw
          </button>
        </div>

        <div className="space-y-6">
          {/* Amount Input */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-sm" style={{color: 'var(--text-secondary)'}}>Amount</label>
            </div>
            
            <div className="p-3 rounded-lg border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full text-2xl font-semibold text-white bg-transparent border-none outline-none placeholder-gray-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <img 
                    src={collateral.icon} 
                    alt={collateral.symbol}
                    className="w-8 h-8"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <span className="font-semibold text-gray-300">{collateral.symbol}</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between mt-3">
                <div className="text-xs text-gray-400">
                  ${(parseFloat(amount || "0") * getTokenPrice(collateral.tokenAddress)).toFixed(2)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {action === 'deposit' ? 'Wallet' : 'Collateral'} balance: {formatBalance(action === 'deposit' ? getWalletBalance() : collateral.amount)}
                  </span>
                  <button
                    onClick={() => setAmount((action === 'deposit' ? getWalletBalance() : getMaxSafeWithdraw()).toString())}
                    className="text-xs font-semibold text-gray-300 hover:text-white"
                  >
                    MAX
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Risk Information */}
          <h4 className="text-sm mb-1" style={{color: 'var(--text-secondary)'}}>Risk Information</h4>
          <div className="p-3 rounded-lg text-base border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
            <div className="flex justify-between mb-1">
              <span className="text-gray-300">Deposited:</span>
              <span className="text-white">{collateral.amount.toFixed(2)} {collateral.symbol}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-gray-300">Current Health factor:</span>
              <span className="text-white">
                {collateralDetails.isLoading ? "..." : 
                 calculateProjectedHealthFactor() ? 
                 `${collateralDetails.healthFactor.toFixed(2)} > ` :
                 collateralDetails.healthFactor.toFixed(2)}
                {calculateProjectedHealthFactor() && (
                  <span className={`${(calculateProjectedHealthFactor() ?? 0) >= 1.5 ? 'text-green-400' : (calculateProjectedHealthFactor() ?? 0) >= 1.1 ? 'text-orange-400' : 'text-red-400'}`}>
                    {calculateProjectedHealthFactor()?.toFixed(2)}
                  </span>
                )}
              </span>
            </div>
            <div className="text-right text-xs">
              <span className="text-gray-300">Liquidation at: </span>
              <span className="text-white">&lt;1.0</span>
            </div>
          </div>

          {/* Warning if withdraw too high */}
          {action === 'withdraw' && projectedHealthFactor && projectedHealthFactor < 1.0 && (
            <div className="bg-red-900 border border-red-600 rounded-lg p-3">
              <div className="text-red-300 text-sm font-semibold">⚠️ Liquidation Risk!</div>
              <div className="text-red-200 text-xs mt-1">
                Withdrawing this amount will drop your Health Factor below 1.0, making you eligible for liquidation.
              </div>
            </div>
          )}

          {/* Buttons */}
          <button
            onClick={handleSubmit}
            disabled={
              !amount || 
              parseFloat(amount) <= 0 || 
              isLoading ||
              Boolean(action === 'withdraw' && projectedHealthFactor && projectedHealthFactor < 1.0) ||
              Boolean(action === 'withdraw' && parseFloat(amount || "0") > collateral.amount) ||
              Boolean(action === 'deposit' && parseFloat(amount || "0") > getWalletBalance())
            }
            className="w-full px-4 py-2 rounded-lg transition-colors border border-gray-600 mt-8 disabled:opacity-50 disabled:cursor-not-allowed text-white"
            style={{
              backgroundColor: action === 'deposit' ? 'var(--button-active)' : 'var(--button-danger)'
            }}
            onMouseEnter={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.backgroundColor = action === 'deposit' ? 'var(--button-hover)' : 'var(--button-danger-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.backgroundColor = action === 'deposit' ? 'var(--button-active)' : 'var(--button-danger)';
              }
            }}
          >
            {isLoading ? (
              <span className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                {isApproving ? 'Approving...' : 'Processing...'}
              </span>
            ) : (
              `${action === 'deposit' ? 'Deposit' : 'Withdraw'} ${collateral.symbol}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
