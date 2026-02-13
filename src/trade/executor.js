import { ethers } from "ethers";
import { deriveApiKey, placeBuyOrder } from "./clob.js";
import { CONFIG } from "../config.js";

const CLOB_URL = CONFIG.clobBaseUrl;

/**
 * Auto-trade executor for BTC 15m markets.
 *
 * When the signal engine fires ENTER, this places a BUY order for the
 * recommended side.  It tracks one position per 15m market window and
 * won't double-buy in the same window.
 */
export class Executor {
  constructor() {
    this.wallet     = null;
    this.creds      = null;
    this.enabled     = false;
    this.currentSlug = null;     // slug of the market we already entered
    this.position    = null;     // { tokenId, side, cost, shares, slug, ts }
    this.history     = [];       // resolved trades
    this.totalPnl    = 0;
  }

  async init() {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) {
      console.log("[trade] PRIVATE_KEY not set – auto-trade disabled (signal-only mode)");
      return;
    }

    const maxUsdc = Number(process.env.MAX_TRADE_USDC) || 10;
    this.maxUsdc = maxUsdc;

    this.wallet = new ethers.Wallet(pk);
    console.log(`[trade] Wallet: ${this.wallet.address}`);
    console.log(`[trade] Max per trade: $${this.maxUsdc}`);

    try {
      this.creds = await deriveApiKey(this.wallet, CLOB_URL);
      console.log(`[trade] CLOB API key: ${this.creds.apiKey.slice(0, 8)}…`);
      this.enabled = true;
    } catch (e) {
      console.log(`[trade] CLOB auth failed: ${e.message} – auto-trade disabled`);
    }
  }

  /**
   * Called every poll cycle with the signal decision and polymarket snapshot.
   */
  async onSignal(rec, poly) {
    if (!this.enabled) return;
    if (rec.action !== "ENTER" || !poly?.ok) return;

    const slug = poly.market?.slug ?? "";
    if (!slug) return;

    // Don't re-enter the same market
    if (this.currentSlug === slug) return;

    const side    = rec.side;  // "UP" or "DOWN"
    const tokenId = side === "UP" ? poly.tokens.upTokenId : poly.tokens.downTokenId;
    const price   = side === "UP" ? poly.prices.up : poly.prices.down;

    if (!tokenId || !price || price <= 0 || price >= 1) return;

    const usdcToSpend = Math.min(this.maxUsdc, 50);

    console.log(`\n[trade] >>> BUY ${side} @ $${price.toFixed(2)} for $${usdcToSpend.toFixed(2)}`);

    try {
      const result = await placeBuyOrder({
        wallet: this.wallet,
        creds:  this.creds,
        clobUrl: CLOB_URL,
        tokenId,
        price,
        usdcAmount: usdcToSpend,
        negRisk: false,   // BTC 15m markets are standard
      });

      if (result.success || result.orderID) {
        const shares = usdcToSpend / price;
        this.currentSlug = slug;
        this.position = { tokenId, side, cost: usdcToSpend, shares, price, slug, ts: Date.now() };
        console.log(`[trade] FILLED – ${side} ${shares.toFixed(1)} shares @ $${price.toFixed(2)}`);
      } else {
        console.log(`[trade] ORDER FAILED: ${result.errorMsg || JSON.stringify(result)}`);
      }
    } catch (e) {
      console.log(`[trade] ERROR: ${e.message}`);
    }
  }

  /**
   * Called when the market window rotates (new slug detected).
   * Resolves the previous position.
   */
  onMarketRotate(newSlug) {
    if (!this.position || this.position.slug === newSlug) return;

    // The 15m market resolved. We either won or lost.
    // We can't know the resolution from the bot alone, so we log it
    // and track based on the last known price direction.
    const p = this.position;
    console.log(`\n[trade] Market resolved: ${p.slug} (held ${p.side} ${p.shares.toFixed(1)} shares @ $${p.price.toFixed(2)})`);
    this.history.push({ ...p, resolvedAt: Date.now() });
    this.position = null;
    this.currentSlug = null;
  }

  statusLine() {
    if (!this.enabled) return "[trade] disabled";
    if (!this.position) return "[trade] waiting for signal…";
    return `[trade] HOLDING ${this.position.side} (${this.position.shares.toFixed(1)} shares @ $${this.position.price.toFixed(2)}) | ${this.history.length} past trades`;
  }
}
