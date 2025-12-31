"use client";

import { useState, useCallback, useMemo } from "react";
import Image from "next/image";
import { useUserBorrow } from "@/hooks/useUserBorrow";
import { useLoanToRepay } from "@/hooks/useRepayLoan";
import { useMarketData } from "@/hooks/useMarketData";
import { useCollateralDetails } from "@/hooks/useCollateral";
import { useAccount } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import BorrowableAssetRow from "../tables/BorrowableAssetRow";
import LoanRepaymentModal from "../modals/LoanRepaymentModal";

export default function BorrowOverview() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { address } = useAccount();
  const { wallets } = useWallets();
  const walletAddress = address || wallets[0]?.address;

  const { userBorrows, healthFactor, supportedTokens, isLoading: borrowLoading } = useUserBorrow(refreshKey);
  const { loanToRepay } = useLoanToRepay();
  const marketData = useMarketData(refreshKey);
  const collateralDetails = useCollateralDetails(walletAddress, refreshKey);
  const [showRepayModal, setShowRepayModal] = useState(false);

  const isLoading = borrowLoading || collateralDetails.isLoading;

  // Callback to refresh data after successful transaction
  const handleTransactionSuccess = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const formatBalance = useCallback((amount: number) => {
    if (amount === 0) return "0";
    if (amount < 0.0001) return amount.toExponential(2);
    if (amount < 1) return amount.toFixed(4);
    if (amount < 1000) return amount.toFixed(2);
    return amount.toLocaleString();
  }, []);

  const getHealthFactorColor = useCallback((hf: number) => {
    if (hf >= 2) return "text-green-400";
    if (hf >= 1.5) return "text-yellow-400";
    if (hf >= 1.1) return "text-orange-400";
    return "text-red-400";
  }, []);

  const borrowsWithPrices = useMemo(() => {
    return userBorrows.borrows.map(borrow => {
      const market = marketData.find(m => m.tokenAddress === borrow.tokenAddress);
      const price = market?.price || 1.00;
      return {
        ...borrow,
        price,
        debtInUSD: borrow.totalDebt * price,
        interestInUSD: borrow.interestOwed * price
      };
    });
  }, [userBorrows.borrows, marketData]);

  return (
    <div className="space-y-6">
      {/* Your Borrows Section */}
      <div className="premium-card rounded-lg overflow-hidden shadow-xl">
        <div className="px-6 py-5 border-b border-gray-700/50 bg-gray-800/20">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white uppercase tracking-tight" style={{ fontFamily: 'var(--font-headline)' }}>Your borrows</h3>
            <div className="flex items-center space-x-3 bg-white/5 px-3 py-1 rounded-full border border-white/10">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Health Factor</span>
              <span className={`text-sm font-semibold ${getHealthFactorColor(healthFactor.healthFactor)}`}>
                {healthFactor.isLoading ? (
                  <span className="inline-block w-8 h-4 bg-gray-700 rounded animate-pulse" />
                ) : healthFactor.healthFactor.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-gray-700/50">
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Asset</th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">Debt</th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">Interest</th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">APY</th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {borrowsWithPrices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-400 italic">
                    Nothing borrowed yet
                  </td>
                </tr>
              ) : (
                borrowsWithPrices.map((borrow, index) => (
                  <tr key={borrow.tokenAddress || index}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="relative w-9 h-9 mr-3">
                          <Image
                            src={borrow.icon}
                            alt={borrow.symbol}
                            fill
                            className="rounded-full object-contain"
                          />
                        </div>
                        <div>
                          <div className="text-base font-semibold text-white">{borrow.symbol}</div>
                          <div className="text-xs text-gray-400">{borrow.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="text-base font-medium text-white">{formatBalance(borrow.totalDebt)}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>${borrow.debtInUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="text-base font-medium text-white">{formatBalance(borrow.interestOwed)}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        ${borrow.interestInUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-base font-medium text-white">
                      {borrow.rate ? borrow.rate.toFixed(2) : "0.00"}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <button
                        onClick={() => {
                          if (loanToRepay) {
                            setShowRepayModal(true);
                          }
                        }}
                        disabled={!loanToRepay}
                        className="px-4 py-1 text-sm font-semibold rounded-lg transition-all text-white active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                        style={{ backgroundColor: 'var(--button-active)' }}
                      >
                        Repay
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assets to Borrow Section */}
      <div className="premium-card rounded-lg overflow-hidden shadow-xl">
        <div className="px-6 py-5 border-b border-gray-700/50 bg-gray-800/20">
          <h3 className="text-lg font-semibold text-white uppercase tracking-tight" style={{ fontFamily: 'var(--font-headline)' }}>Assets to borrow</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-gray-700/50">
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Asset</th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">Available</th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">APY, variable</th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {supportedTokens.map((token) => {
                const currentBorrow = userBorrows.borrows.find(b => b.tokenAddress.toLowerCase() === token.tokenAddress.toLowerCase());
                const borrowedAmount = currentBorrow?.totalDebt || 0;
                const market = marketData.find(m => m.tokenAddress.toLowerCase() === token.tokenAddress.toLowerCase());

                return (
                  <BorrowableAssetRow
                    key={token.tokenAddress}
                    token={token}
                    formatBalance={formatBalance}
                    onTransactionSuccess={handleTransactionSuccess}
                    refreshKey={refreshKey}
                    borrowedAmount={borrowedAmount}
                    market={market}
                    collateralDetails={collateralDetails}
                    userBorrows={userBorrows}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {supportedTokens.length === 0 && (
          <div className="px-6 py-8 text-center text-gray-400 text-sm italic">
            No assets available to borrow
          </div>
        )}
      </div>

      {/* Repay Modal */}
      {showRepayModal && loanToRepay && (
        <LoanRepaymentModal
          isOpen={showRepayModal}
          onClose={() => setShowRepayModal(false)}
          loanToRepay={loanToRepay}
          formatBalance={formatBalance}
          onTransactionSuccess={handleTransactionSuccess}
        />
      )}
    </div>
  );
}
