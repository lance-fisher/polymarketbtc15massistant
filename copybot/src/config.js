// Auto-load .env (works on any Node version, no --env-file needed)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dir = dirname(fileURLToPath(import.meta.url));
const __envPath = join(__dir, "..", ".env");
if (existsSync(__envPath)) {
  for (const line of readFileSync(__envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#\s][^=]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

const e = process.env;

export const CFG = {
  privateKey:      e.PRIVATE_KEY || "",
  polygonRpc:      e.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com",

  targetUsername:  e.TARGET_USERNAME || "anoin123",
  targetAddress:   e.TARGET_ADDRESS || "",

  maxTradeUsdc:    Number(e.MAX_TRADE_USDC) || 5,
  maxPortfolioUsdc: Number(e.MAX_PORTFOLIO_USDC) || 15,
  maxPositions:    Number(e.MAX_POSITIONS) || 3,
  maxDailyUsdc:    Number(e.MAX_DAILY_USDC) || 20,
  maxSpreadCents:  Number(e.MAX_SPREAD_CENTS) || 8,
  maxNewPerCycle:  3,          // hardcoded — enter multiple positions per cycle
  pollIntervalS:   Number(e.POLL_INTERVAL_S) || 20,

  twilio: {
    sid:    e.TWILIO_ACCOUNT_SID || "",
    token:  e.TWILIO_AUTH_TOKEN || "",
    from:   e.TWILIO_FROM_NUMBER || "",
  },
  notifyPhone:     e.NOTIFY_PHONE || "+19189066963",

  gammaUrl:  "https://gamma-api.polymarket.com",
  dataUrl:   "https://data-api.polymarket.com",
  clobUrl:   "https://clob.polymarket.com",
  chainId:   137,

  // Contracts (Polygon)
  usdc:             "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  ctf:              "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  exchange:         "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  negRiskExchange:  "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  negRiskAdapter:   "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
};
