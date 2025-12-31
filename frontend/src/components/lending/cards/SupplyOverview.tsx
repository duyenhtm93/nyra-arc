"use client";

import { useState, useCallback, useMemo } from "react";
import Image from "next/image";
import { useUserSupply, useSupplyRates } from "@/hooks/useUserSupply";
import { useMarketData } from "@/hooks/useMarketData";
import SupplyableAssetRow from "../tables/SupplyableAssetRow";
import SupplyManagementRow from "../tables/SupplyManagementRow";

export default function SupplyOverview() {
  const [refreshKey, setRefreshKey] = useState(0);

  const { userSupplies, walletBalances, isLoading } = useUserSupply(refreshKey);
  const marketData = useMarketData(refreshKey);

  // Callback to refresh data after successful transaction
  const handleTransactionSuccess = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const formatBalance = useCallback((amount: number) => {
    if (amount === 0) return "0.00";
    return amount.toFixed(2);
  }, []);

  const suppliesWithPrices = useMemo(() => {
    return userSupplies.supplies
      .filter(Boolean)
      .map(supply => {
        const market = marketData.find(m => m.tokenAddress.toLowerCase() === supply.tokenAddress.toLowerCase());
        const price = market?.price || 1.00;
        const totalAmount = supply.amount + supply.interestEarned;
        return {
          ...supply,
          price,
          totalAmount,
          totalValueUSD: totalAmount * price,
          interestUSD: supply.interestEarned * price,
          lendRate: market?.lendRate || 0
        };
      });
  }, [userSupplies.supplies, marketData]);

  return (
    <div className="space-y-6">
      {/* Your Supplies Section */}
      <div className="premium-card rounded-lg overflow-hidden shadow-xl">
        <div className="px-6 py-5 border-b border-gray-700/50 bg-gray-800/20">
          <h3 className="text-lg font-semibold text-white uppercase tracking-tight" style={{ fontFamily: 'var(--font-headline)' }}>Your supplies</h3>
        </div>

        {isLoading ? (
          <div className="text-gray-400 text-center py-12 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin"></div>
            <span className="text-sm">Loading supplies...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 border-b border-gray-700/50">
                  <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Asset</th>
                  <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">Amount</th>
                  <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">Interest</th>
                  <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">APY</th>
                  <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {suppliesWithPrices.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-gray-400 text-center py-8 italic">
                      Nothing supplied yet
                    </td>
                  </tr>
                ) : (
                  suppliesWithPrices.map((supply, index) => (
                    <tr key={supply.tokenAddress || index}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="relative w-9 h-9 mr-3">
                            <Image
                              src={supply.icon}
                              alt={supply.symbol}
                              fill
                              className="rounded-full object-contain"
                            />
                          </div>
                          <div>
                            <div className="text-base font-semibold text-white">{supply.symbol}</div>
                            <div className="text-xs text-gray-400">{supply.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="text-base font-medium text-white">{formatBalance(supply.totalAmount)}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>${supply.totalValueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="text-base font-medium text-white">{formatBalance(supply.interestEarned)}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>${supply.interestUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-white font-medium">
                        {supply.lendRate.toFixed(2)}%
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <SupplyManagementRow
                          supply={supply}
                          walletBalance={walletBalances.find(w => w.tokenAddress.toLowerCase() === supply.tokenAddress.toLowerCase())?.balance || 0}
                          formatBalance={formatBalance}
                          onTransactionSuccess={handleTransactionSuccess}
                          market={marketData.find(m => m.tokenAddress.toLowerCase() === supply.tokenAddress.toLowerCase())}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Assets to Supply Section */}
      <div className="premium-card rounded-lg overflow-hidden shadow-xl">
        <div className="px-6 py-5 border-b border-gray-700/50 bg-gray-800/20">
          <h3 className="text-lg font-semibold text-white uppercase tracking-tight" style={{ fontFamily: 'var(--font-headline)' }}>Assets to supply</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-gray-700/50">
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Assets</th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">Wallet balance</th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">APY</th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {walletBalances.map((asset) => {
                const existingSupply = userSupplies.supplies.find(s => s.tokenAddress.toLowerCase() === asset.tokenAddress.toLowerCase());
                const market = marketData.find(m => m.tokenAddress.toLowerCase() === asset.tokenAddress.toLowerCase());
                return (
                  <SupplyableAssetRow
                    key={asset.tokenAddress}
                    asset={asset}
                    formatBalance={formatBalance}
                    onTransactionSuccess={handleTransactionSuccess}
                    currentSupplied={existingSupply?.amount || 0}
                    market={market}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {walletBalances.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm italic">
            No assets available to supply
          </div>
        )}
      </div>
    </div>
  );
}

