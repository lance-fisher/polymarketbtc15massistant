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
    const batch = await res.json();
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
  const book = await res.json();

  const bids = book.bids || [];
  const asks = book.asks || [];

  const bestBid = bids.length ? Math.max(...bids.map(b => Number(b.price))) : null;
  const bestAsk = asks.length ? Math.min(...asks.map(a => Number(a.price))) : null;
  const bidDepth = bids.slice(0, 5).reduce((s, b) => s + Number(b.size || 0), 0);
  const askDepth = asks.slice(0, 5).reduce((s, a) => s + Number(a.size || 0), 0);

  return { bestBid, bestAsk, bidDepth, askDepth };
}

/**
 * Parse market into tradeable outcomes with prices and token IDs.
 */
export function parseOutcomes(market) {
  const outcomes = Array.isArray(market.outcomes)
    ? market.outcomes
    : (typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : []);

  const prices = Array.isArray(market.outcomePrices)
    ? market.outcomePrices.map(Number)
    : (typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices).map(Number) : []);

  const tokenIds = Array.isArray(market.clobTokenIds)
    ? market.clobTokenIds
    : (typeof market.clobTokenIds === "string" ? JSON.parse(market.clobTokenIds) : []);

  const result = [];
  for (let i = 0; i < outcomes.length; i++) {
    if (!tokenIds[i]) continue;
    result.push({
      label:   String(outcomes[i]),
      price:   prices[i] ?? null,
      tokenId: String(tokenIds[i]),
    });
  }
  return result;
}
