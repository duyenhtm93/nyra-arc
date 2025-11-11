"use client";

import { useMarketData } from "@/hooks/useMarketData";
import { getTokenName } from "@/utils/tokenInfo";

export default function MarketOverview() {
  const marketData = useMarketData();

  const prioritizedAssets = ["USDC", "EURC"] as const;

  const sortedMarkets = marketData
    .map((market, originalIndex) => ({ market, originalIndex }))
    .sort((a, b) => {
      const priorityA = prioritizedAssets.indexOf(a.market.asset as typeof prioritizedAssets[number]);
      const priorityB = prioritizedAssets.indexOf(b.market.asset as typeof prioritizedAssets[number]);

      const isAPrioritized = priorityA !== -1;
      const isBPrioritized = priorityB !== -1;

      if (isAPrioritized && isBPrioritized) {
        return priorityA - priorityB;
      }

      if (isAPrioritized) return -1;
      if (isBPrioritized) return 1;

      return a.originalIndex - b.originalIndex;
    })
    .map(({ market }) => market);

  // Calculate market metrics
  const calculateMarketMetrics = () => {
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
  };

  const metrics = calculateMarketMetrics();

  const formatUSD = (amount: number) => {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-6">
      {/* Market Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Market Size */}
        <div className="rounded-lg p-6 border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
          <div className="text-2xl font-bold mb-1 text-center" style={{color: 'var(--text-primary)'}}>
            {marketData.some(data => data.isLoading) ? "..." : formatUSD(metrics.totalMarketSize)}
          </div>
          <div className="text-sm text-center" style={{color: 'var(--text-secondary)'}}>Total Market Size</div>
        </div>

        {/* Total Available */}
        <div className="rounded-lg p-6 border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
          <div className="text-2xl font-bold mb-1 text-center" style={{color: 'var(--text-primary)'}}>
            {marketData.some(data => data.isLoading) ? "..." : formatUSD(metrics.totalAvailable)}
          </div>
          <div className="text-sm text-center" style={{color: 'var(--text-secondary)'}}>Total Available</div>
        </div>

        {/* Total Borrows */}
        <div className="rounded-lg p-6 border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
          <div className="text-2xl font-bold mb-1 text-center" style={{color: 'var(--text-primary)'}}>
            {marketData.some(data => data.isLoading) ? "..." : formatUSD(metrics.totalBorrows)}
          </div>
          <div className="text-sm text-center" style={{color: 'var(--text-secondary)'}}>Total Borrows</div>
        </div>
      </div>
      <div className="rounded-lg overflow-hidden border border-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
        <div className="px-6 py-4 border-b border-gray-700">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-white">All Markets</h2>
            <div className="text-sm text-gray-400">
              {marketData.some(data => data.isLoading) && "Loading..."}
              {marketData.some(data => data.error) && "Error loading data"}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>
                  Asset
                </th>
                <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>
                  Price
                </th>
                <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>
                  Total Supplied
                </th>
                <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>
                  Supply APY
                </th>
                <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>
                  Total Borrowed
                </th>
                <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>
                  Borrow APY
                </th>
                <th className="px-6 py-3 text-right text-xs font-normal tracking-wider" style={{color: 'var(--text-secondary)'}}>
                  Utilization
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-600" style={{backgroundColor: 'var(--background-secondary)'}}>
              {sortedMarkets.map((market, index) => (
                <tr key={market.tokenAddress ?? index} className="hover:bg-gray-750">
                  <td className="px-6 py-3 whitespace-nowrap">
                    <div className="flex items-center">
                      <img 
                        src={market.icon} 
                        alt={market.asset}
                        className="w-8 h-8 mr-3 rounded-full"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div>
                        <div className="text-base font-medium text-white">{market.asset}</div>
                        <div className="text-xs" style={{color: 'var(--text-secondary)'}}>
                          {getTokenName(market.tokenAddress)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                    ${market.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                    {market.error ? (
                      <span className="text-red-400 text-xs">Error</span>
                    ) : market.isLoading ? (
                      "..."
                    ) : (
                      <div>
                        <div>{`${market.totalSupplied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${market.asset}`}</div>
                        <div className="text-xs" style={{color: 'var(--text-secondary)'}}>
                          ${(market.totalSupplied * market.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                    {market.error ? (
                      <span className="text-red-400 text-xs">Error</span>
                    ) : market.isLoading ? (
                      "..."
                    ) : (
                      `${market.lendRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                    {market.error ? (
                      <span className="text-red-400 text-xs">Error</span>
                    ) : market.isLoading ? (
                      "..."
                    ) : (
                      <div>
                        <div>{`${market.totalBorrowed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${market.asset}`}</div>
                        <div className="text-xs" style={{color: 'var(--text-secondary)'}}>
                          ${(market.totalBorrowed * market.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                    {market.isLoading ? "..." : `${market.borrowRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-right text-base" style={{color: 'var(--text-primary)'}}>
                    {market.isLoading ? "..." : `${market.utilization.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}
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
