"use client";

import { useState, useCallback, useMemo } from "react";
import Image from "next/image";
import { useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useUserCollaterals, useWalletBalances, useCollateralDetails } from "@/hooks/useCollateral";
import { useMarketData } from "@/hooks/useMarketData";
import CollateralAssetRow from "../tables/CollateralAssetRow";

export default function CollateralOverview() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { address } = useAccount();
  const { wallets } = useWallets();
  const userAddress = address || wallets[0]?.address;

  const { collaterals, isLoading: collateralsLoading } = useUserCollaterals(userAddress, refreshKey);
  const { balances, isLoading: balancesLoading } = useWalletBalances(userAddress, refreshKey);
  const collateralDetails = useCollateralDetails(userAddress, refreshKey);
  const marketData = useMarketData(refreshKey);

  const isLoading = collateralsLoading || balancesLoading || collateralDetails.isLoading;

  const handleTransactionSuccess = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const formatBalance = useCallback((amount: number) => {
    if (amount === 0) return "0.00";
    if (amount < 0.01) return amount.toFixed(4);
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, []);

  const collateralsWithMarketData = useMemo(() => {
    return collaterals.map(col => {
      const market = marketData.find(m => m.tokenAddress.toLowerCase() === col.tokenAddress.toLowerCase());
      return {
        ...col,
        ltv: market?.ltv || 0,
        price: market?.price || 0
      };
    });
  }, [collaterals, marketData]);

  try {
    return (
      <div className="space-y-6">
        {/* Your Collaterals Section - Premium Card */}
        <div className="premium-card rounded-lg overflow-hidden shadow-xl">
          <div className="px-6 py-5 border-b border-gray-700/50 bg-gray-800/20">
            <h3 className="text-lg font-semibold text-white uppercase tracking-tight" style={{ fontFamily: 'var(--font-headline)' }}>Your collaterals</h3>
          </div>

          {collateralsWithMarketData.length === 0 ? (
            <div className="text-gray-400 text-center py-10 italic">
              No collateral deposited yet
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {collateralsWithMarketData.map((collateral, index) => (
                <div key={collateral.tokenAddress || index} className="flex justify-between items-center p-4 bg-gray-800/40 rounded-lg border border-gray-700/50">
                  <div className="flex items-center">
                    <div className="relative w-10 h-10 mr-4">
                      <Image
                        src={collateral.icon}
                        alt={collateral.symbol}
                        fill
                        className="rounded-full object-contain"
                      />
                    </div>
                    <div>
                      <div className="text-base font-semibold text-white">{collateral.symbol}</div>
                      <div className="text-sm font-medium text-gray-400">
                        {formatBalance(collateral.amount)} {collateral.symbol}
                        <span className="ml-2 text-xs text-gray-500">
                          (${(collateral.amount * collateral.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Max LTV</div>
                    <div className="text-base font-semibold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                      {collateral.ltv}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assets to Supply Section - Premium Card */}
        <div className="premium-card rounded-lg overflow-hidden shadow-xl">
          <div className="px-6 py-5 border-b border-gray-700/50 bg-gray-800/20">
            <h3 className="text-lg font-semibold text-white uppercase tracking-tight" style={{ fontFamily: 'var(--font-headline)' }}>Assets to supply as collateral</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 border-b border-gray-700/50">
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400" style={{ fontFamily: 'var(--font-headline)' }}>Asset</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right" style={{ fontFamily: 'var(--font-headline)' }}>Wallet Balance</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right" style={{ fontFamily: 'var(--font-headline)' }}>Max LTV</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-gray-400 text-center" style={{ fontFamily: 'var(--font-headline)' }}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {balances.map((asset, index) => {
                  const market = marketData.find(m => m.tokenAddress.toLowerCase() === asset.tokenAddress.toLowerCase());
                  return (
                    <CollateralAssetRow
                      key={asset.tokenAddress || index}
                      token={asset}
                      formatBalance={formatBalance}
                      onTransactionSuccess={handleTransactionSuccess}
                      market={market}
                      collateralDetails={collateralDetails}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error("❌ CollateralOverview error:", error);
    return (
      <div className="bg-red-900/20 border border-red-900 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-red-400 mb-4 uppercase tracking-tight" style={{ fontFamily: 'var(--font-headline)' }}>Error loading collateral</h3>
        <div className="text-red-300">
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </div>
    );
  }
}
