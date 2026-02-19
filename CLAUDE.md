# Polymarket BTC 15m Assistant

Real-time console TA assistant for Polymarket BTC Up/Down 15-minute markets.
JavaScript + Node.js + ethers.js.

## Quick Ref
- **Run**: `npm start`
- **Copybot**: `cd copybot && npm start`
- **GitHub**: lance-fisher/polymarketbtc15massistant
- **Config**: Environment variables (no .env file by default — set in shell or create .env)

## What It Does
- Streams Polymarket BTC 15-min market prices
- Pulls Chainlink BTC/USD on-chain oracle price
- Pulls Binance spot BTC price
- Computes short-term TA: Heiken Ashi, RSI(14), MACD(12,26,9), VWAP
- Color-coded console output: green = bullish, red = bearish

## Copybot
- Path: `copybot/`
- Mirrors a target trader's Polymarket positions via Data API
- Separate package.json, run independently
- Needs: `PRIVATE_KEY` (Polygon wallet) for trade execution

## Key Files
- `src/index.js` — Main entry, polling loop
- `src/indicators.js` — TA calculations (RSI, MACD, VWAP, Heiken Ashi)
- `src/polymarket.js` — Polymarket API client
- `src/chainlink.js` — On-chain Chainlink oracle reader
- `copybot/index.js` — Copy-trading bot

## Integration Points
- Shares Polygon wallet (`PRIVATE_KEY`) with master-trade-bot and polymarket-sniper
- Shares CLOB credentials with master-trade-bot and polymarket-sniper
- Standalone — does NOT connect to profit-desk or master-trade-bot

## Ecosystem Context
See `D:\ProjectsHome\trading-shared\` for:
- `TRADING_CONTEXT.md` — Full architecture, API reference, shared learnings
- `WALLET_REGISTRY.md` — Which credentials go where
- `STRATEGIES.md` — All strategies across ecosystem
- `DISPATCH.md` — How to run and monitor all bots

## Related Projects
- **polymarket-sniper**: Latency-based expiration sniping (different approach)
- **master-trade-bot**: Has its own Polymarket engine (CLOB sniper)
- All three Polymarket projects should use the SAME Polygon wallet
