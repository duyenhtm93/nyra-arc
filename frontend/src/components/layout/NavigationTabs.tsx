"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo } from "react";

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
  const pathname = usePathname();

  return (
    <nav className={`flex gap-1 ${className}`}>
      {tabs.map((tab) => {
        const isActive = pathname === tab.path;
        const isFaucet = tab.id === 'faucet';

        return (
          <Link
            key={tab.id}
            href={tab.path}
            prefetch={true}
            className={`
              tab-button px-4 py-2 rounded-lg transition-all duration-200 h-[38px] flex items-center justify-center
              ${isFaucet
                ? "text-white font-semibold cursor-pointer border border-gray-600"
                : isActive
                  ? "text-white font-semibold cursor-default border border-gray-600"
                  : "hover:text-white cursor-pointer text-gray-400"
              }
            `}
            style={{
              backgroundColor: isFaucet || isActive
                ? "var(--background-secondary)"
                : "transparent",
            }}
            aria-current={isActive ? 'page' : undefined}
          >
            <div className="flex items-center gap-2">
              {tab.icon && <span>{tab.icon}</span>}
              <span>{tab.label}</span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

export default memo(NavigationTabs);

