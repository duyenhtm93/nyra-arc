"use client";

import SupplyOverview from "../lending/cards/SupplyOverview";
import BorrowOverview from "../lending/cards/BorrowOverview";

export default function LendingDashboard() {
  return (
    <div className="space-y-6">
      {/* 2x2 Grid Layout - 4 separate cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          <SupplyOverview />
        </div>
        
        {/* Right Column */}
        <div className="space-y-6">
          <BorrowOverview />
        </div>
      </div>
    </div>
  );
}
