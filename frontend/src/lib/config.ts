"use client";

import { CONTRACT_ADDRESSES, TOKEN_INFO, INTEREST_RATES, LTV_RATES } from "@/lib/contracts";

// Tab configuration
export const TAB_CONFIG = [
  {
    id: "market",
    label: "Market",
    path: "/",
  },
  {
    id: "earn", 
    label: "Earn",
    path: "/earn",
  },
  {
    id: "collateral",
    label: "Collateral",
    path: "/collateral",
  },
  {
    id: "faucet",
    label: "Faucet",
    path: "/faucet",
  }
] as const;

// Market data configuration
export const MARKET_DATA = [
  {
    asset: "USDC",
    icon: "💵",
    totalSupplied: "$1,000.00",
    supplyAPY: "10.00%",
    totalBorrowed: "$500.00", 
    borrowAPY: "15.00%",
    utilization: "50.00%"
  },
  {
    asset: "BTC",
    icon: "₿",
    totalSupplied: "$650.00",
    supplyAPY: "5.00%",
    totalBorrowed: "$200.00",
    borrowAPY: "8.00%", 
    utilization: "30.77%"
  },
  {
    asset: "ETH",
    icon: "Ξ",
    totalSupplied: "$3,200.00",
    supplyAPY: "15.00%",
    totalBorrowed: "$1,000.00",
    borrowAPY: "20.00%",
    utilization: "31.25%"
  }
] as const;

// Earn data configuration
export const EARN_DATA = {
  supply: [
    { asset: "USDC", icon: "💵", apy: "10.00%" },
    { asset: "BTC", icon: "₿", apy: "5.00%" },
    { asset: "ETH", icon: "Ξ", apy: "15.00%" }
  ],
  borrow: [
    { asset: "USDC", icon: "💵", apy: "15.00%" },
    { asset: "BTC", icon: "₿", apy: "8.00%" },
    { asset: "ETH", icon: "Ξ", apy: "20.00%" }
  ]
} as const;

// Dashboard data configuration
export const DASHBOARD_DATA = {
  totalCollateral: "$0.00",
  collateralAPY: "+0.00%",
  totalBorrowed: "$0.00", 
  borrowedAPY: "-0.00%",
  netWorth: "$0.00",
  healthFactor: "999.00",
  riskLevel: "Safe"
} as const;
