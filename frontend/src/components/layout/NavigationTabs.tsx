"use client";

import { useRouter, usePathname } from "next/navigation";
import { memo, useCallback } from "react";

interface TabItem {
  id: string;
  label: string;
  path: string;
  icon?: string;
}

interface NavigationTabsProps {
  tabs: TabItem[];
  className?: string;
}

function NavigationTabs({ tabs, className = "" }: NavigationTabsProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleTabClick = useCallback((path: string) => {
    if (pathname !== path) {
      router.push(path);
    }
  }, [router, pathname]);

  return (
    <nav className={`flex gap-1 ${className}`}>
      {tabs.map((tab) => {
        const isActive = pathname === tab.path;
        const isFaucet = tab.id === 'faucet';
        
        return (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.path)}
            disabled={isActive && !isFaucet}
            className={`
              tab-button px-4 py-2 rounded-lg transition-all duration-200 h-[38px] flex items-center justify-center
              ${
                isFaucet
                  ? "text-white font-semibold cursor-pointer border border-gray-600"
                  : isActive
                  ? "text-white font-semibold cursor-default border border-gray-600"
                  : "hover:text-white cursor-pointer"
              }
            `}
            style={{
              backgroundColor: isFaucet
                ? "var(--background-secondary)"
                : isActive
                ? "var(--background-secondary)"
                : "transparent",
              color: isFaucet
                ? "var(--text-primary)"
                : isActive
                ? "var(--text-primary)"
                : "var(--text-secondary)",
            }}
            aria-current={isActive ? 'page' : undefined}
          >
            <div className="flex items-center gap-2">
              {tab.icon && <span>{tab.icon}</span>}
              <span>{tab.label}</span>
            </div>
          </button>
        );
      })}
    </nav>
  );
}

export default memo(NavigationTabs);
