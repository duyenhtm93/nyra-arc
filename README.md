# Nyra Finance

Nyra is a decentralized lending and borrowing protocol built exclusively for the **Arc Testnet**. It enables users to deposit collateral (BTC, ETH, BNB) and borrow stablecoins (USDC, EURC) with dynamic interest rates.

## 🏗 Project Structure

The repository is organized into three main components:

- **`/contracts`**: Solidity smart contracts (Hardhat). Core logic for Lending, Collateral Management, and Price Oracles.
- **`/backend`**: TypeScript Price Keeper bot. Fetches real-time market data to update the on-chain `ManualPriceOracle`.
- **`/frontend`**: Next.js (App Router) user interface. Integrated with Privy for seamless embedded wallet experiences.

## 🚀 Quick Start

### 1. Smart Contracts
```bash
cd contracts
npm install
# Deploy tokens, oracles, and managers
npx hardhat run scripts/deployTestTokens.ts --network arc
npx hardhat run scripts/deployManualPriceOracle.ts --network arc
npx hardhat run scripts/deployCollateralManager.ts --network arc
npx hardhat run scripts/deployLoanManager.ts --network arc
# Configure the system
npx hardhat run scripts/setupCollateralManager.ts --network arc
npx hardhat run scripts/setupLoanContract.ts --network arc
```

### 2. Backend (Price Keeper)
Configure `.env` with the deployment addresses and a Keeper private key.
```bash
cd backend
npm install
npm run build
npm run pm2:start # Runs continuously via PM2
```

### 3. Frontend
Sync the latest ABIs and addresses, then launch the UI.
```bash
cd frontend
npm install
npm run genabi # Synchronize contracts from /contracts/deployments
npm run dev
```

## 🛠 Tech Stack
- **Blockchain**: Solidity, Hardhat, Viem/Wagmi.
- **Backend**: Node.js, Ethers.js, PM2.
- **Frontend**: Next.js 15, React 19, Tailwind CSS, Privy.
- **Network**: Arc Testnet (Chain ID: `5042002`).

## 📄 License
MIT
