const e = process.env;

export const CFG = {
  privateKey:       e.PRIVATE_KEY || "",
  polygonRpc:       e.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com",

  maxTradeUsdc:     Number(e.MAX_TRADE_USDC) || 5,
  maxPortfolioUsdc: Number(e.MAX_PORTFOLIO_USDC) || 15,
  maxPositions:     Number(e.MAX_POSITIONS) || 3,
  maxDailyUsdc:     Number(e.MAX_DAILY_USDC) || 10,
  maxSpreadCents:   Number(e.MAX_SPREAD_CENTS) || 5,
  scanIntervalS:    Number(e.SCAN_INTERVAL_S) || 60,
  minEdge:          Number(e.MIN_EDGE) || 0.12,
  minLiquidity:     Number(e.MIN_LIQUIDITY) || 5000,

  gammaUrl:  "https://gamma-api.polymarket.com",
  dataUrl:   "https://data-api.polymarket.com",
  clobUrl:   "https://clob.polymarket.com",
  chainId:   137,

  usdc:             "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  ctf:              "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  exchange:         "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  negRiskExchange:  "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  negRiskAdapter:   "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
};
