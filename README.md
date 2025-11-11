## Nyra Finance

Nyra is a lending interface running exclusively on Arc Testnet. It provides a streamlined experience for lenders and borrowers to interact with the Nyra protocol.

### Key Features
- Market overview with USDC, EURC, and other assets showing APY and liquidity.
- Earn & Collateral flows: deposit/withdraw funds, monitor health factor, liquidation alerts.
- Faucet page to claim test assets quickly.
- Wallet support for Privy embedded wallets and RainbowKit EOA connectors; automatically prompts users to switch to Arc Testnet.

### Requirements
- Node.js >= 18
- Environment variables defined in `.env.local`:
  ```
  NEXT_PUBLIC_ARC_RPC_URL=<Arc Testnet RPC>
  NEXT_PUBLIC_PRIVY_APP_ID=<Privy App ID>
  NEXT_PUBLIC_PRIVY_API_HOST=<Privy API Host>
  NEXT_PUBLIC_ARCSCAN_URL=https://testnet.arcscan.app
  ```
- Optional: set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` if additional connectors are enabled.

### Install & Run
```bash
npm install
npm run dev
```
App will be available at http://localhost:3000.

### Useful Scripts
- `npm run lint` – lint the project
- `npm run build` – create a production build
- `npm run start` – serve the production build
- `npm run test` – execute unit tests (if available)

### Project Structure
```
frontend/
├── public/            # static assets (icons, logos)
├── src/
│   ├── app/           # Next.js app router pages, layouts, providers
│   ├── components/    # UI components (layout, lending tables, modals...)
│   ├── hooks/         # React hooks for protocol data & wallet logic
│   ├── config/        # chain and wagmi configuration
│   ├── lib/           # shared config/constants
│   ├── utils/         # helpers for token info, addresses
│   └── abi/           # generated contract ABIs & addresses
└── README.md
```

### Development Notes
- The app targets a single network (`ARC_CHAIN_ID = 5042002`). Network selector UI has been removed; users are prompted to switch in their wallet if they are on the wrong chain.
- Token data is sourced from contract calls (LoanManager, CollateralManager, PriceOracle). USDC and EURC are prioritized in market tables.
- Toast notifications are centralized in `useToast`; transaction success toasts include deep-links to ArcScan.
- Embedded wallets (Privy) have custom flows for approvals and transactions; wagmi connectors are used for EOA wallets.

### Deployment Checklist
1. Ensure `.env.local` is populated with production RPC and Privy credentials.
2. Run `npm run lint` and `npm run build`; fix any reported issues.
3. Verify faucet endpoints and tokens are seeded on Arc Testnet.
4. Commit & push changes, then deploy via your preferred platform (Vercel, custom infra, etc.).

### Resources
- [Arc Network Docs](https://docs.arc.network/) (chain reference)
- [Privy Wallets](https://docs.privy.io/wallets/overview) (embedded wallet integration)
- [RainbowKit](https://www.rainbowkit.com/docs/introduction) (EOA connectors)
