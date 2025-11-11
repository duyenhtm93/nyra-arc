# Backend Services

Utilities and background jobs for Nyra on the Arc network.

## Price Updater Bot

Fetches USD prices from CoinGecko and pushes them into `ManualPriceOracle`.

### Setup

1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```

2. Create `.env` in this directory:
   ```
   ARC_RPC_URL=https://rpc.testnet.arc.network
   PRIVATE_KEY=your_private_key_without_0x
   MANUAL_ORACLE_ADDRESS=<latest_manual_price_oracle>
   BTC_ADDRESS=<btc_token_address>
   ETH_ADDRESS=<eth_token_address>
   BNB_ADDRESS=<bnb_token_address>
   USDC_ADDRESS=<usdc_token_address>
   EURC_ADDRESS=<eurc_token_address>
   PRICE_UPDATE_INTERVAL_SECONDS=0
   COINGECKO_API_BASE=https://api.coingecko.com/api/v3
   ```

   > `PRICE_UPDATE_INTERVAL_SECONDS=0` means "run once and exit". Set to `300` for 5‑minute updates.

### Commands

- **Run once**
  ```bash
  npm run update-prices
  ```

- **Run continuously (example 5 minutes)**
  ```bash
  PRICE_UPDATE_INTERVAL_SECONDS=300 npm run update-prices
  ```

Use cron, PM2, or a container to keep the process alive in production.

### Deploying to Render (Background Worker)

1. **Service type**: Background Worker  
2. **Build command**: `npm install && npm run build`  
3. **Start command**: `npm run start`  
4. **Environment variables**: same as `.env` above.  
5. Set `PRICE_UPDATE_INTERVAL_SECONDS` to a non-zero value (e.g. `300`) so the worker stays alive.

The build step compiles TypeScript to `dist/`, and the start command runs `dist/priceUpdater.js`.

### Current Coverage

- Tokens: BTC, ETH, BNB, USDC (CoinGecko feed) và EURC (cố định 1.0 USD) – set địa chỉ qua `.env`, mở rộng thêm trong `TOKENS` nếu cần.
- Networks: Arc Testnet (uses USDC gas, Arc RPC configurable via env)
- Oracle: `ManualPriceOracle` expects 8‑decimals USD prices (handled by helper `usdToOraclePrice`)

### Future Enhancements

- Add health checks / logging pipeline
- Support fallback RPCs & CoinGecko rate limiting
- Extend to Arc mainnet once contracts are redeployed

