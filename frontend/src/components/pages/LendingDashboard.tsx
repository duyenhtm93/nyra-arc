"use client";

import SupplyOverview from "../lending/cards/SupplyOverview";
import BorrowOverview from "../lending/cards/BorrowOverview";

export default function LendingDashboard() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <SupplyOverview />
        </div>

        <div className="space-y-6">
          <BorrowOverview />
        </div>
      </div>
    </div>
  );
}
