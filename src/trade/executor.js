import { ethers } from "ethers";
import { deriveApiKey, placeBuyOrder } from "./clob.js";
import { CONFIG } from "../config.js";
import { fetchOrderBook, summarizeOrderBook } from "../data/polymarket.js";

const CLOB_URL = CONFIG.clobBaseUrl;

/**
 * Auto-trade executor for BTC 15m markets.
 *
 * Safeguards:
 *   - One position per 15m market window (no double-buy)
 *   - Per-trade cap (MAX_TRADE_USDC)
 *   - Daily spending cap ($30 default, resets midnight ET)
 *   - Spread guard — skips if spread > 8 cents
 *   - Max 1 trade per market (inherent from slug tracking)
 */
export class Executor {
  constructor() {
    this.wallet     = null;
    this.creds      = null;
    this.enabled     = false;
    this.currentSlug = null;
    this.position    = null;
    this.history     = [];
    this.totalPnl    = 0;
    this.dailySpent  = 0;
    this.dailyResetDate = "";
    this.maxDailyUsdc = Number(process.env.MAX_DAILY_USDC) || 10;
    this.maxSpreadCents = Number(process.env.MAX_SPREAD_CENTS) || 5;
  }

  _todayET() {
    return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
  }

  _resetDailyIfNeeded() {
    const today = this._todayET();
    if (this.dailyResetDate !== today) {
      this.dailySpent = 0;
      this.dailyResetDate = today;
    }
  }

  async init() {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) {
      console.log("[trade] PRIVATE_KEY not set – auto-trade disabled (signal-only mode)");
      return;
    }

    const maxUsdc = Number(process.env.MAX_TRADE_USDC) || 5;
    this.maxUsdc = maxUsdc;

    this.wallet = new ethers.Wallet(pk);
    console.log(`[trade] Wallet: ${this.wallet.address}`);
    console.log(`[trade] Max per trade: $${this.maxUsdc} | Daily cap: $${this.maxDailyUsdc} | Max spread: ${this.maxSpreadCents}c`);

    try {
      this.creds = await deriveApiKey(this.wallet, CLOB_URL);
      console.log(`[trade] CLOB API key: ${this.creds.apiKey.slice(0, 8)}…`);
      this.enabled = true;
    } catch (e) {
      console.log(`[trade] CLOB auth failed: ${e.message} – auto-trade disabled`);
    }
  }

  async onSignal(rec, poly) {
    if (!this.enabled) return;
    if (rec.action !== "ENTER" || !poly?.ok) return;

    const slug = poly.market?.slug ?? "";
    if (!slug) return;

    // Don't re-enter the same market
    if (this.currentSlug === slug) return;

    // ── Guard: daily cap ──
    this._resetDailyIfNeeded();
    if (this.dailySpent + this.maxUsdc > this.maxDailyUsdc) {
      return; // silently skip — status line will show
    }

    const side    = rec.side;  // "UP" or "DOWN"
    const tokenId = side === "UP" ? poly.tokens.upTokenId : poly.tokens.downTokenId;
    const price   = side === "UP" ? poly.prices.up : poly.prices.down;

    if (!tokenId || !price || price <= 0 || price >= 1) return;

    // ── Guard: spread check ──
    try {
      const book = await fetchOrderBook({ tokenId });
      const summary = summarizeOrderBook(book);
      const spreadCents = summary.spread != null ? Math.round(summary.spread * 100) : null;
      if (spreadCents != null && spreadCents > this.maxSpreadCents) {
        console.log(`[trade] Skip — spread ${spreadCents}c > ${this.maxSpreadCents}c`);
        return;
      }
    } catch {
      // If we can't check spread, proceed with caution
    }

    const usdcToSpend = Math.min(this.maxUsdc, 50);

    console.log(`\n[trade] >>> BUY ${side} @ ${(price * 100).toFixed(0)}c for $${usdcToSpend.toFixed(2)}`);

    try {
      const result = await placeBuyOrder({
        wallet: this.wallet,
        creds:  this.creds,
        clobUrl: CLOB_URL,
        tokenId,
        price,
        usdcAmount: usdcToSpend,
        negRisk: false,
      });

      if (result.success || result.orderID) {
        const shares = usdcToSpend / price;
        this.currentSlug = slug;
        this.position = { tokenId, side, cost: usdcToSpend, shares, price, slug, ts: Date.now() };
        this.dailySpent += usdcToSpend;
        console.log(`[trade] FILLED – ${side} ${shares.toFixed(1)} shares @ ${(price * 100).toFixed(0)}c`);
      } else {
        console.log(`[trade] ORDER FAILED: ${result.errorMsg || JSON.stringify(result)}`);
      }
    } catch (e) {
      console.log(`[trade] ERROR: ${e.message}`);
    }
  }

  onMarketRotate(newSlug) {
    if (!this.position || this.position.slug === newSlug) return;
    const p = this.position;
    console.log(`\n[trade] Market resolved: ${p.slug} (held ${p.side} ${p.shares.toFixed(1)} shares @ ${(p.price * 100).toFixed(0)}c)`);
    this.history.push({ ...p, resolvedAt: Date.now() });
    this.position = null;
    this.currentSlug = null;
  }

  statusLine() {
    if (!this.enabled) return "disabled";
    const dailyInfo = `$${this.dailySpent.toFixed(0)}/$${this.maxDailyUsdc} today`;
    if (!this.position) return `waiting for signal… | ${dailyInfo}`;
    return `HOLDING ${this.position.side} (${this.position.shares.toFixed(1)} shares @ ${(this.position.price * 100).toFixed(0)}c) | ${dailyInfo} | ${this.history.length} past`;
  }
}
