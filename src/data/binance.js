import { CONFIG } from "../config.js";

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/* ── Kraken (primary — works in US, no auth needed) ──────── */

const KRAKEN_INTERVAL_MAP = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };

async function fetchKlinesKraken({ interval, limit }) {
  const mins = KRAKEN_INTERVAL_MAP[interval] || 15;
  const url = `https://api.kraken.com/0/public/OHLC?pair=XBTUSDT&interval=${mins}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Kraken OHLC error: ${res.status}`);
  const json = await res.json();
  if (json.error && json.error.length) throw new Error(`Kraken: ${json.error[0]}`);

  const pair = Object.keys(json.result).find(k => k !== "last");
  const raw = json.result[pair] || [];

  return raw.slice(-limit).map((k) => ({
    openTime:  k[0] * 1000,
    open:      toNumber(k[1]),
    high:      toNumber(k[2]),
    low:       toNumber(k[3]),
    close:     toNumber(k[4]),
    volume:    toNumber(k[6]),  // index 6 on Kraken (5 is VWAP)
    closeTime: k[0] * 1000 + mins * 60 * 1000 - 1
  }));
}

async function fetchLastPriceKraken() {
  const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSDT", { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Kraken ticker error: ${res.status}`);
  const json = await res.json();
  const pair = Object.keys(json.result)[0];
  return toNumber(json.result[pair].c[0]);
}

/* ── Binance.US (fallback) ───────────────────────────────── */

async function fetchKlinesBinance({ interval, limit }) {
  const url = new URL("/api/v3/klines", CONFIG.binanceBaseUrl);
  url.searchParams.set("symbol", CONFIG.symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
  const data = await res.json();

  return data.map((k) => ({
    openTime: Number(k[0]),
    open: toNumber(k[1]),
    high: toNumber(k[2]),
    low: toNumber(k[3]),
    close: toNumber(k[4]),
    volume: toNumber(k[5]),
    closeTime: Number(k[6])
  }));
}

async function fetchLastPriceBinance() {
  const url = new URL("/api/v3/ticker/price", CONFIG.binanceBaseUrl);
  url.searchParams.set("symbol", CONFIG.symbol);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Binance last price error: ${res.status}`);
  const data = await res.json();
  return toNumber(data.price);
}

/* ── Exported: Kraken first, Binance.US fallback ─────────── */

export async function fetchKlines(opts) {
  try {
    return await fetchKlinesKraken(opts);
  } catch (e) {
    try {
      return await fetchKlinesBinance(opts);
    } catch (e2) {
      throw new Error(`All price sources failed: Kraken(${e.message}), Binance(${e2.message})`);
    }
  }
}

export async function fetchLastPrice() {
  try {
    return await fetchLastPriceKraken();
  } catch {
    return await fetchLastPriceBinance();
  }
}
