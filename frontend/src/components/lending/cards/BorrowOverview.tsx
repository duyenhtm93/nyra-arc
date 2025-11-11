"use client";

import { useState, useCallback } from "react";
import { useUserBorrow } from "@/hooks/useUserBorrow";
import { useLoanToRepay } from "@/hooks/useRepayLoan";
import { useMarketData } from "@/hooks/useMarketData";
import BorrowableAssetRow from "../tables/BorrowableAssetRow";
import LoanRepaymentModal from "../modals/LoanRepaymentModal";

export default function BorrowOverview() {
  const [refreshKey, setRefreshKey] = useState(0);
  
  const { userBorrows, healthFactor, supportedTokens, isLoading } = useUserBorrow(refreshKey);
  const { loanToRepay } = useLoanToRepay();
  const marketData = useMarketData();
  const [showRepayModal, setShowRepayModal] = useState(false);

  // Callback to refresh data after successful transaction
  const handleTransactionSuccess = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const formatBalance = (amount: number) => {
    if (amount === 0) return "0";
    if (amount < 0.0001) return amount.toExponential(2);
    if (amount < 1) return amount.toFixed(4);
    if (amount < 1000) return amount.toFixed(2);
    return amount.toLocaleString();
  };

  // Get token price from market data
  const getTokenPrice = (tokenAddress: string) => {
    const market = marketData.find(m => m.tokenAddress === tokenAddress);
    return market?.price || 1.00;
  };

  const getHealthFactorColor = (hf: number) => {
    if (hf >= 2) return "text-green-400";
    if (hf >= 1.5) return "text-yellow-400";
    if (hf >= 1.1) return "text-orange-400";
    return "text-red-400";
  };

  return (
    <div className="space-y-6">
      {/* Your Borrows Section */}
      <div className="rounded-lg overflow-hidden border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
        <div className="px-6 py-4 border-b border-gray-700">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold" style={{color: 'var(--text-primary)'}}>Your borrows</h3>
            <div className="flex items-center space-x-2">
              <span className="text-xs" style={{color: 'var(--text-secondary)'}}>Health Factor:</span>
              <span className={`text-sm font-semibold ${getHealthFactorColor(healthFactor.healthFactor)}`}>
                {healthFactor.isLoading ? "..." : healthFactor.healthFactor.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
        
        {isLoading ? (
          <div className="animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-700 rounded w-1/2"></div>
          </div>
        ) : userBorrows.borrows.length === 0 ? (
          <div className="text-gray-400 text-center py-8">
            Nothing borrowed yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Asset</th>
                  <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Debt</th>
                  <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Interest</th>
                  <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>APY</th>
                  <th className="px-6 py-3 text-center text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
                {userBorrows.borrows.map((borrow, index) => (
                  <tr key={index} className="hover:bg-gray-750">
                    <td className="px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center">
                        <img 
                          src={borrow.icon} 
                          alt={borrow.symbol}
                          className="w-8 h-8 mr-3 rounded-full"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                        <div>
                          <div className="text-base" style={{color: 'var(--text-primary)'}}>{borrow.symbol}</div>
                          <div className="text-xs" style={{color: 'var(--text-secondary)'}}>{borrow.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                      <div>{formatBalance(borrow.totalDebt)}</div>
                      <div className="text-xs" style={{color: 'var(--text-secondary)'}}>${(borrow.totalDebt * getTokenPrice(borrow.tokenAddress)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                      <div>{formatBalance(borrow.interestOwed)}</div>
                      <div className="text-xs" style={{color: 'var(--text-secondary)'}}>
                        ${(borrow.interestOwed * getTokenPrice(borrow.tokenAddress)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                      {borrow.rate.toFixed(2)}%
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-center">
                      <button
                        onClick={() => {
                          if (loanToRepay) {
                            setShowRepayModal(true);
                          }
                        }}
                        disabled={!loanToRepay}
                        className="px-3 py-1 text-base rounded transition-colors text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{backgroundColor: 'var(--button-active)'}}
                        onMouseEnter={(e) => {
                          if (!e.currentTarget.disabled) {
                            e.currentTarget.style.backgroundColor = 'var(--button-hover)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!e.currentTarget.disabled) {
                            e.currentTarget.style.backgroundColor = 'var(--button-active)';
                          }
                        }}
                      >
                        Repay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Assets to Borrow Section */}
      <div className="rounded-lg overflow-hidden border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold" style={{color: 'var(--text-primary)'}}>Assets to borrow</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Asset</th>
                <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Available</th>
                <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>APY, variable</th>
                <th className="px-6 py-3 text-center text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
              {supportedTokens.map((token) => {
                // Find borrowed amount for this token
                const currentBorrow = userBorrows.borrows.find(b => b.tokenAddress.toLowerCase() === token.tokenAddress.toLowerCase());
                const borrowedAmount = currentBorrow?.amount || 0;
                
                return (
                  <BorrowableAssetRow 
                    key={token.tokenAddress} 
                    token={token} 
                    formatBalance={formatBalance}
                    onTransactionSuccess={handleTransactionSuccess}
                    refreshKey={refreshKey}
                    borrowedAmount={borrowedAmount}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {supportedTokens.length === 0 && (
          <div className="px-6 py-4 text-center text-gray-400 text-sm">
            No assets available to borrow
          </div>
        )}
      </div>

      {/* Repay Modal */}
      {(() => {
        const modalIsOpen = showRepayModal && !!loanToRepay;
        return (
          <LoanRepaymentModal
            isOpen={modalIsOpen}
            onClose={() => setShowRepayModal(false)}
            loanToRepay={loanToRepay || {
              tokenAddress: '',
              symbol: '',
              icon: '',
              name: '',
              principal: 0,
              interestOwed: 0,
              totalDebt: 0,
              rawPrincipal: BigInt(0),
              rawTotalDebt: BigInt(0)
            }}
            formatBalance={formatBalance}
            onTransactionSuccess={handleTransactionSuccess}
          />
        );
      })()}
    </div>
  );
}
