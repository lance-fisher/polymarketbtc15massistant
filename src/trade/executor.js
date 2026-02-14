import { ethers } from "ethers";
import { deriveApiKey, placeBuyOrder } from "./clob.js";
import { CONFIG } from "../config.js";
import { fetchOrderBook, summarizeOrderBook } from "../data/polymarket.js";

const CLOB_URL = CONFIG.clobBaseUrl;

// Polygon mainnet contracts
const USDC_ADDR         = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const CTF_ADDR          = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const EXCHANGE          = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const NEG_RISK_ADAPTER  = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Auto-trade executor for BTC 15m markets.
 *
 * Safeguards:
 *   - One position per 15m market window (no double-buy)
 *   - Per-trade cap (MAX_TRADE_USDC)
 *   - Daily spending cap ($30 default, resets midnight ET)
 *   - Spread guard — skips if spread > 8 cents
 *   - Max 1 trade per market (inherent from slug tracking)
 *   - Auto-approves USDC/CTF on first run
 *   - Retries CLOB auth up to 5 times
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

  /**
   * Check and set USDC + CTF approvals for all exchange contracts.
   * Only sends transactions if approvals are missing.
   */
  async _ensureApprovals() {
    const MAX = ethers.MaxUint256;
    const gasOverrides = {
      maxFeePerGas: ethers.parseUnits("50", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("30", "gwei"),
    };

    const usdc = new ethers.Contract(USDC_ADDR, [
      "function approve(address,uint256) returns (bool)",
      "function allowance(address,address) view returns (uint256)",
    ], this.wallet);

    const ctf = new ethers.Contract(CTF_ADDR, [
      "function setApprovalForAll(address,bool)",
      "function isApprovedForAll(address,address) view returns (bool)",
    ], this.wallet);

    const targets = [
      { label: "CTF Exchange",     addr: EXCHANGE },
      { label: "NegRisk Exchange", addr: NEG_RISK_EXCHANGE },
      { label: "NegRisk Adapter",  addr: NEG_RISK_ADAPTER },
    ];

    for (const t of targets) {
      try {
        const allow = await usdc.allowance(this.wallet.address, t.addr);
        if (allow < ethers.parseUnits("1000000", 6)) {
          console.log(`[trade] Approving USDC → ${t.label}…`);
          const tx = await usdc.approve(t.addr, MAX, gasOverrides);
          await tx.wait();
          console.log(`[trade]   ✓ USDC approved (${tx.hash.slice(0, 10)}…)`);
        }

        const ok = await ctf.isApprovedForAll(this.wallet.address, t.addr);
        if (!ok) {
          console.log(`[trade] Approving CTF → ${t.label}…`);
          const tx = await ctf.setApprovalForAll(t.addr, true, gasOverrides);
          await tx.wait();
          console.log(`[trade]   ✓ CTF approved (${tx.hash.slice(0, 10)}…)`);
        }
      } catch (e) {
        console.log(`[trade] Approval for ${t.label}: ${e.message.slice(0, 80)}`);
      }
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

    const provider = new ethers.JsonRpcProvider(
      process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com",
      137, { staticNetwork: true }
    );
    this.wallet = new ethers.Wallet(pk, provider);
    console.log(`[trade] Wallet: ${this.wallet.address}`);
    console.log(`[trade] Max per trade: $${this.maxUsdc} | Daily cap: $${this.maxDailyUsdc} | Max spread: ${this.maxSpreadCents}c`);

    // ── Check USDC balance ──
    try {
      const usdc = new ethers.Contract(USDC_ADDR, ["function balanceOf(address) view returns (uint256)"], provider);
      const bal = Number(await usdc.balanceOf(this.wallet.address)) / 1e6;
      console.log(`[trade] USDC balance: $${bal.toFixed(2)}`);
      if (bal < this.maxUsdc) {
        console.log(`[trade] ⚠ Balance ($${bal.toFixed(2)}) < MAX_TRADE_USDC ($${this.maxUsdc}) — fund wallet to trade`);
      }
    } catch (e) {
      console.log(`[trade] Could not check balance: ${e.message.slice(0, 60)}`);
    }

    // ── Auto-approve USDC/CTF if needed ──
    await this._ensureApprovals();

    // ── Derive CLOB API credentials (with retry) ──
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        this.creds = await deriveApiKey(this.wallet, CLOB_URL);
        console.log(`[trade] CLOB API key: ${this.creds.apiKey.slice(0, 8)}…`);
        this.enabled = true;
        break;
      } catch (e) {
        console.log(`[trade] CLOB auth attempt ${attempt}/5 failed: ${e.message}`);
        if (attempt < 5) {
          await sleep(attempt * 3000);
        } else {
          console.log("[trade] CLOB auth failed after 5 attempts – auto-trade disabled");
        }
      }
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

    const usdcToSpend = this.maxUsdc;

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

      // Auto-refresh API key on auth failure
      if (result.status === 401 || result.status === 403 || (result.errorMsg || "").includes("auth")) {
        console.log("[trade] API key expired — re-deriving…");
        try { this.creds = await deriveApiKey(this.wallet, CLOB_URL); console.log("[trade] New API key derived"); } catch (e) { console.log(`[trade] Re-derive failed: ${e.message}`); }
        return;
      }

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
