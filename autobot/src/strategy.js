import { CFG } from "./config.js";

/**
 * Autonomous Strategy Engine
 *
 * Identifies mispriced outcomes across all Polymarket markets.
 *
 * Core principles (inspired by top traders like anoin123):
 *   1. CONTRARIAN PANIC — when the crowd panics, buy cheap "No" outcomes
 *   2. MEAN REVERSION  — extreme prices (>90¢ or <10¢) tend to revert
 *   3. TIME DECAY      — markets near expiry with extreme prices = highest edge
 *   4. LIQUIDITY       — only trade markets you can actually exit
 *   5. DIVERSIFY       — spread risk across uncorrelated markets
 */

/**
 * Score a single market outcome for trading opportunity.
 * Returns null if not tradeable, or a scored opportunity object.
 */
export function scoreOutcome(market, outcome) {
  const { label, price, tokenId } = outcome;
  if (price === null || price <= 0 || price >= 1) return null;

  const liquidity = Number(market.liquidityNum || market.liquidity || 0);
  if (liquidity < CFG.minLiquidity) return null;

  const volume24h = Number(market.volume24hr || market.volume_24h || 0);
  const volume = Number(market.volumeNum || market.volume || 0);
  const negRisk = market.negRisk === true || market.negRisk === "true";

  // ── Time analysis ──
  const endDate = market.endDate ? new Date(market.endDate).getTime() : null;
  const now = Date.now();
  const hoursLeft = endDate ? (endDate - now) / 3_600_000 : null;

  // Skip markets that already expired or expire in <1 hour (too risky for autonomous)
  if (hoursLeft !== null && hoursLeft < 1) return null;
  // Skip markets >90 days out (too far, low edge)
  if (hoursLeft !== null && hoursLeft > 90 * 24) return null;

  // ── Price-based scoring ──
  let score = 0;
  let reason = [];

  // CONTRARIAN: cheap outcomes (<15¢) on active markets = potential panic selling
  if (price <= 0.15 && volume24h > 500) {
    score += 3;
    reason.push(`cheap@${(price * 100).toFixed(0)}¢`);
  } else if (price <= 0.25 && volume24h > 1000) {
    score += 2;
    reason.push(`underpriced@${(price * 100).toFixed(0)}¢`);
  }

  // MEAN REVERSION: extreme prices on either side
  // Buy the cheap side when the expensive side looks overextended
  const complementPrice = 1 - price;
  if (complementPrice > 0.90) {
    score += 2;
    reason.push("complement>90¢");
  }

  // TIME DECAY: markets expiring in 1-7 days with cheap outcomes = value
  if (hoursLeft !== null && hoursLeft >= 1 && hoursLeft <= 168 && price <= 0.30) {
    score += 2;
    reason.push(`expires_${Math.round(hoursLeft)}h`);
  }

  // VOLUME SURGE: high recent volume suggests market movement / opportunity
  if (volume24h > 5000) {
    score += 1;
    reason.push("high_vol");
  }

  // LIQUIDITY BONUS: well-liquid markets are safer
  if (liquidity > 10000) {
    score += 1;
    reason.push("deep_liquidity");
  }

  // ── Edge calculation ──
  // Our "fair value" model: extreme prices revert toward center.
  // For very cheap outcomes (<20¢), estimate fair value as price + contrarian_edge.
  // This is a simple model — real edge comes from the scoring factors above.
  let fairValue;
  if (price <= 0.10) {
    fairValue = price + 0.08;   // cheap outcomes are ~8% undervalued
  } else if (price <= 0.20) {
    fairValue = price + 0.06;
  } else if (price <= 0.30) {
    fairValue = price + 0.04;
  } else if (price >= 0.85) {
    fairValue = price - 0.04;   // expensive outcomes overvalued
  } else {
    fairValue = price;          // fair-priced, no edge
  }

  const edge = fairValue - price;
  if (edge < CFG.minEdge && score < 4) return null;  // not enough edge

  // ── Risk assessment ──
  // Potential return: if we buy at `price` and it resolves YES → profit = (1 - price)
  // Risk/reward ratio: (1 - price) / price
  const rrRatio = (1 - price) / price;

  // ── Final composite score ──
  const composite = score + (edge * 10) + Math.min(rrRatio, 5);

  return {
    market: {
      id:         market.id || market.conditionId,
      conditionId: market.conditionId,
      slug:       market.slug,
      question:   market.question,
      negRisk,
      endDate:    market.endDate,
      liquidity,
      volume24h,
    },
    outcome:  label,
    tokenId,
    price,
    fairValue: Math.round(fairValue * 100) / 100,
    edge:     Math.round(edge * 1000) / 1000,
    rrRatio:  Math.round(rrRatio * 10) / 10,
    score:    Math.round(composite * 10) / 10,
    reasons:  reason,
    hoursLeft: hoursLeft ? Math.round(hoursLeft) : null,
    side:     edge > 0 ? "BUY" : "SKIP",
  };
}

/**
 * Scan all markets and return the best opportunities, ranked by composite score.
 */
export function rankOpportunities(markets) {
  const opportunities = [];

  for (const m of markets) {
    const outcomes = parseOutcomesSafe(m);
    for (const o of outcomes) {
      const scored = scoreOutcome(m, o);
      if (scored && scored.side === "BUY") {
        opportunities.push(scored);
      }
    }
  }

  // Sort by composite score descending
  opportunities.sort((a, b) => b.score - a.score);
  return opportunities;
}

function parseOutcomesSafe(market) {
  try {
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
      result.push({ label: String(outcomes[i]), price: prices[i] ?? null, tokenId: String(tokenIds[i]) });
    }
    return result;
  } catch { return []; }
}
