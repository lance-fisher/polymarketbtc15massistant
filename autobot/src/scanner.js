import { CFG } from "./config.js";

/**
 * Scans all active Polymarket markets and returns enriched market data.
 */
export async function scanMarkets() {
  const markets = [];
  let offset = 0;
  const limit = 100;

  // Paginate through all active markets
  while (true) {
    const url = `${CFG.gammaUrl}/markets?active=true&closed=false&enableOrderBook=true&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) break;
    const batch = await res.json().catch(() => null);
    if (!Array.isArray(batch) || batch.length === 0) break;
    markets.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
    if (offset > 500) break;  // cap at 500 markets per scan
  }

  return markets;
}

/**
 * Fetch order book summary for a token.
 */
export async function fetchBook(tokenId) {
  const res = await fetch(`${CFG.clobUrl}/book?token_id=${tokenId}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const book = await res.json().catch(() => null);
  if (!book) return null;

  const bids = book.bids || [];
  const asks = book.asks || [];

  const bestBid = bids.length ? Math.max(...bids.map(b => Number(b.price))) : null;
  const bestAsk = asks.length ? Math.min(...asks.map(a => Number(a.price))) : null;
  const bidDepth = bids.slice(0, 5).reduce((s, b) => s + Number(b.size || 0), 0);
  const askDepth = asks.slice(0, 5).reduce((s, a) => s + Number(a.size || 0), 0);

  return { bestBid, bestAsk, bidDepth, askDepth };
}
