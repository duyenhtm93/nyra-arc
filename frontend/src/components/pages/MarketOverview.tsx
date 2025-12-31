"use client";

import { useMemo } from "react";
import Image from "next/image";
import { useMarketData } from "@/hooks/useMarketData";
import { getTokenName } from "@/utils/tokenInfo";

export default function MarketOverview() {
  const marketData = useMarketData();

  const prioritizedAssets = useMemo(() => ["USDC", "EURC"] as const, []);

  const sortedMarkets = useMemo(() => {
    return [...marketData]
      .sort((a, b) => {
        const priorityA = prioritizedAssets.indexOf(a.asset as typeof prioritizedAssets[number]);
        const priorityB = prioritizedAssets.indexOf(b.asset as typeof prioritizedAssets[number]);

        const isAPrioritized = priorityA !== -1;
        const isBPrioritized = priorityB !== -1;

        if (isAPrioritized && isBPrioritized) {
          return priorityA - priorityB;
        }

        if (isAPrioritized) return -1;
        if (isBPrioritized) return 1;

        // Fallback to original order if possible or stable sort
        return 0;
      });
  }, [marketData, prioritizedAssets]);

  // Calculate market metrics
  const metrics = useMemo(() => {
    let totalMarketSize = 0;
    let totalAvailable = 0;
    let totalBorrows = 0;

    marketData.forEach(market => {
      if (!market.isLoading && !market.error) {
        const suppliedUSD = market.totalSupplied * market.price;
        const borrowedUSD = market.totalBorrowed * market.price;

        totalMarketSize += suppliedUSD;
        totalBorrows += borrowedUSD;
        totalAvailable += (market.totalSupplied - market.totalBorrowed) * market.price;
      }
    });

    return {
      totalMarketSize,
      totalAvailable,
      totalBorrows
    };
  }, [marketData]);

  const formatUSD = (amount: number) => {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const isDataLoading = marketData.some(data => data.isLoading);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Market Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Market Size */}
        <div className="premium-card rounded-lg p-6 shadow-xl">
          <div className="text-3xl font-semibold mb-1 tracking-tight" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-headline)' }}>
            {formatUSD(metrics.totalMarketSize)}
          </div>
          <div className="text-sm font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Total Market Size</div>
        </div>

        {/* Total Available */}
        <div className="premium-card rounded-lg p-6 shadow-xl">
          <div className="text-3xl font-semibold mb-1 tracking-tight" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-headline)' }}>
            {formatUSD(metrics.totalAvailable)}
          </div>
          <div className="text-sm font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Total Available</div>
        </div>

        {/* Total Borrows */}
        <div className="premium-card rounded-lg p-6 shadow-xl">
          <div className="text-3xl font-semibold mb-1 tracking-tight" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-headline)' }}>
            {formatUSD(metrics.totalBorrows)}
          </div>
          <div className="text-sm font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Total Borrows</div>
        </div>
      </div>

      <div className="premium-card rounded-lg overflow-hidden shadow-2xl">
        <div className="px-6 py-5 border-b border-gray-700/50 bg-gray-800/20">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-white" style={{ fontFamily: 'var(--font-headline)' }}>All Markets</h2>
            <div className="text-sm">
              {marketData.some(data => data.error) ? (
                <span className="text-red-400">Error fetching data</span>
              ) : (
                <span className="text-green-400">● Live</span>
              )}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-gray-700/50">
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Asset
                </th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">
                  Price
                </th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">
                  Total Supplied
                </th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">
                  Supply APY
                </th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">
                  Total Borrowed
                </th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">
                  Borrow APY
                </th>
                <th className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">
                  Utilization
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {sortedMarkets.map((market, index) => (
                <tr key={market.tokenAddress ?? index}>
                  <td className="px-6 py-3 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="relative w-8 h-8 mr-3">
                        <Image
                          src={market.icon}
                          alt={market.asset}
                          fill
                          className="rounded-full object-contain"
                        />
                      </div>
                      <div>
                        <div className="text-base font-medium text-white">{market.asset}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {getTokenName(market.tokenAddress)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
                    {market.price !== undefined ? `$${market.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "..."}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
                    {market.error ? (
                      <span className="text-red-400 text-xs">Error</span>
                    ) : (
                      <div>
                        <div>{`${market.totalSupplied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${market.asset}`}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          ${(market.totalSupplied * market.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
                    {market.error ? (
                      <span className="text-red-400 text-xs">Error</span>
                    ) : (
                      `${market.lendRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
                    {market.error ? (
                      <span className="text-red-400 text-xs">Error</span>
                    ) : (
                      <div>
                        <div>{`${market.totalBorrowed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${market.asset}`}</div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          ${(market.totalBorrowed * market.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
                    {`${market.borrowRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{ color: 'var(--text-primary)' }}>
                    {`${market.utilization.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

