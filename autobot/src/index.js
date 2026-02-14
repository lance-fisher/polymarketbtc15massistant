#!/usr/bin/env node
/**
 * Polymarket Autonomous Trading Bot
 *
 * Scans all active markets, scores opportunities using a contrarian/value
 * strategy, and trades autonomously.
 *
 * Safeguards:
 *   - Portfolio cap (MAX_PORTFOLIO_USDC)
 *   - Position cap (MAX_POSITIONS)
 *   - Daily spending cap (MAX_DAILY_USDC) — resets at midnight ET
 *   - Spread guard (MAX_SPREAD_CENTS)
 *   - Max 2 new entries per scan cycle
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ethers } from "ethers";
import { CFG } from "./config.js";
import { deriveApiKey, placeBuyOrder } from "./clob.js";
import { scanMarkets, fetchBook } from "./scanner.js";
import { rankOpportunities } from "./strategy.js";

const STATE_FILE = new URL("../../autobot-state.json", import.meta.url).pathname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ts = () => new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
function todayET() {
  return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

function loadState() {
  if (existsSync(STATE_FILE)) { try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
  return { positions: {}, history: [], totalInvested: 0, totalReturned: 0, dailySpent: 0, dailyResetDate: "" };
}
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

async function main() {
  console.log(`
╔══════════════════════════════════════════════════╗
║   Polymarket Autonomous Bot  ·  Own Path Mode    ║
╚══════════════════════════════════════════════════╝`);

  if (!CFG.privateKey) { console.error("PRIVATE_KEY required. See .env.example"); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(CFG.polygonRpc, 137, { staticNetwork: true });
  const wallet = new ethers.Wallet(CFG.privateKey, provider);
  console.log(`[init] Wallet: ${wallet.address}`);

  let creds;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      creds = await deriveApiKey(wallet);
      console.log(`[init] CLOB API: ${creds.apiKey.slice(0, 8)}…`);
      break;
    } catch (e) {
      console.log(`[init] CLOB auth attempt ${attempt}/5 failed: ${e.message}`);
      if (attempt === 5) { console.error("[init] CLOB auth failed after 5 attempts"); process.exit(1); }
      await sleep(attempt * 3000);
    }
  }

  // Check balance
  try {
    const usdcAbi = ["function balanceOf(address) view returns (uint256)"];
    const usdcC = new ethers.Contract(CFG.usdc, usdcAbi, provider);
    const bal = Number(await usdcC.balanceOf(wallet.address)) / 1e6;
    console.log(`[init] USDC balance: $${bal.toFixed(2)}`);
    if (bal < CFG.maxTradeUsdc) {
      console.log(`[init] ⚠ Balance ($${bal.toFixed(2)}) < MAX_TRADE_USDC ($${CFG.maxTradeUsdc}) — fund wallet to trade`);
    }
  } catch { console.log("[init] Could not check balance"); }

  // ── Auto-approve USDC/CTF for exchange contracts ──
  {
    const MAX = ethers.MaxUint256;
    const gasOv = { maxFeePerGas: ethers.parseUnits("50", "gwei"), maxPriorityFeePerGas: ethers.parseUnits("30", "gwei") };
    const usdc = new ethers.Contract(CFG.usdc,
      ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"], wallet);
    const ctf = new ethers.Contract(CFG.ctf,
      ["function setApprovalForAll(address,bool)", "function isApprovedForAll(address,address) view returns (bool)"], wallet);
    for (const [label, addr] of [["Exchange", CFG.exchange], ["NegRisk Exchange", CFG.negRiskExchange], ["NegRisk Adapter", CFG.negRiskAdapter]]) {
      try {
        const allow = await usdc.allowance(wallet.address, addr);
        if (allow < ethers.parseUnits("1000000", 6)) {
          console.log(`[approve] USDC → ${label}…`);
          const tx = await usdc.approve(addr, MAX, gasOv);
          await tx.wait();
          console.log(`[approve] ✓ USDC approved (${tx.hash.slice(0, 10)}…)`);
        }
        if (!(await ctf.isApprovedForAll(wallet.address, addr))) {
          console.log(`[approve] CTF → ${label}…`);
          const tx = await ctf.setApprovalForAll(addr, true, gasOv);
          await tx.wait();
          console.log(`[approve] ✓ CTF approved (${tx.hash.slice(0, 10)}…)`);
        }
      } catch (e) {
        console.log(`[approve] ${label}: ${e.message.slice(0, 80)}`);
      }
    }
  }

  const state = loadState();
  const posCount = Object.keys(state.positions).length;
  console.log(`[init] ${posCount} active positions loaded`);
  console.log(`[init] Limits: $${CFG.maxTradeUsdc}/trade | $${CFG.maxPortfolioUsdc} portfolio | ${CFG.maxPositions} positions | $${CFG.maxDailyUsdc}/day | ${CFG.maxSpreadCents}c max spread`);
  console.log(`[init] Scanning every ${CFG.scanIntervalS}s | Min edge ${(CFG.minEdge * 100).toFixed(0)}%`);
  console.log("═".repeat(52));

  let cycle = 0;
  while (true) {
    cycle++;
    try {
      // ── Reset daily spending at midnight ET ──
      const today = todayET();
      if (state.dailyResetDate !== today) {
        state.dailySpent = 0;
        state.dailyResetDate = today;
        saveState(state);
      }

      // ── 1. Scan all markets ──
      console.log(`\n[${ts()}] Scan #${cycle} — fetching markets…`);
      const markets = await scanMarkets();
      console.log(`[scan] ${markets.length} active markets found`);

      // ── 2. Rank opportunities ──
      const opps = rankOpportunities(markets);
      console.log(`[scan] ${opps.length} opportunities scored`);

      // Show top 5
      const top = opps.slice(0, 5);
      if (top.length) {
        console.log("\n  TOP OPPORTUNITIES:");
        console.log("  ─────────────────────────────────────────────");
        for (const [i, o] of top.entries()) {
          const q = (o.market.question || "").slice(0, 50);
          console.log(`  ${i + 1}. ${o.outcome} @ ${(o.price * 100).toFixed(0)}c  edge:${(o.edge * 100).toFixed(1)}%  score:${o.score}  R/R:${o.rrRatio}x`);
          console.log(`     "${q}…"  [${o.reasons.join(", ")}]`);
        }
        console.log("  ─────────────────────────────────────────────");
      }

      // ── 3. Execute top opportunities ──
      const currentPositionCount = Object.keys(state.positions).length;
      const currentExposure = Object.values(state.positions).reduce((s, p) => s + p.cost, 0);
      const slots = CFG.maxPositions - currentPositionCount;
      const budgetLeft = CFG.maxPortfolioUsdc - currentExposure;

      if (slots <= 0) {
        console.log(`[trade] Max positions (${CFG.maxPositions}) reached — holding`);
      } else if (budgetLeft <= 1) {
        console.log(`[trade] Portfolio budget exhausted ($${currentExposure.toFixed(0)}/$${CFG.maxPortfolioUsdc}) — holding`);
      } else if ((state.dailySpent || 0) >= CFG.maxDailyUsdc) {
        console.log(`[trade] Daily cap reached ($${state.dailySpent.toFixed(0)}/$${CFG.maxDailyUsdc}) — holding`);
      } else {
        let traded = 0;
        for (const opp of opps) {
          if (traded >= 2) break;           // max 2 new entries per scan
          if (slots - traded <= 0) break;

          // Skip if we already hold a position in this market
          const key = opp.market.conditionId + "_" + opp.tokenId;
          if (state.positions[key]) continue;

          // ── Guard: daily spending cap ──
          if ((state.dailySpent || 0) + CFG.maxTradeUsdc > CFG.maxDailyUsdc) {
            console.log(`[trade] Daily cap ($${CFG.maxDailyUsdc}) would be exceeded — stopping`);
            break;
          }

          // ── Guard: spread check (fetch actual book) ──
          try {
            const book = await fetchBook(opp.tokenId);
            if (book && book.bestAsk != null && book.bestBid != null) {
              const spreadCents = Math.round((book.bestAsk - book.bestBid) * 100);
              if (spreadCents > CFG.maxSpreadCents) {
                console.log(`[trade] Skip "${(opp.market.question || "").slice(0, 40)}" — spread ${spreadCents}c > ${CFG.maxSpreadCents}c`);
                continue;
              }
            }
          } catch { /* book fetch failed, proceed with caution */ }

          const usdcToSpend = Math.min(CFG.maxTradeUsdc, budgetLeft - (traded * CFG.maxTradeUsdc));
          if (usdcToSpend < 1) break;

          console.log(`\n[trade] >>> BUY "${opp.outcome}" @ ${(opp.price * 100).toFixed(0)}c for $${usdcToSpend.toFixed(2)}`);
          console.log(`[trade]     "${(opp.market.question || "").slice(0, 60)}"`);
          console.log(`[trade]     edge:${(opp.edge * 100).toFixed(1)}% | R/R:${opp.rrRatio}x | reasons:[${opp.reasons.join(",")}]`);

          const result = await placeBuyOrder({
            wallet, creds,
            tokenId: opp.tokenId,
            price: opp.price,
            usdcAmount: usdcToSpend,
            negRisk: opp.market.negRisk,
          });

          // Auto-refresh API key on auth failure
          if (result.status === 401 || result.status === 403 || (result.errorMsg || "").includes("auth")) {
            console.log("[auth] API key expired — re-deriving…");
            try { creds = await deriveApiKey(wallet); console.log("[auth] New API key derived"); } catch (e) { console.log(`[auth] Re-derive failed: ${e.message}`); }
            break;
          }

          if (result.success || result.orderID) {
            const shares = usdcToSpend / opp.price;
            state.positions[key] = {
              tokenId:     opp.tokenId,
              conditionId: opp.market.conditionId,
              outcome:     opp.outcome,
              question:    (opp.market.question || "").slice(0, 80),
              slug:        opp.market.slug,
              price:       opp.price,
              cost:        usdcToSpend,
              shares,
              negRisk:     opp.market.negRisk,
              edge:        opp.edge,
              reasons:     opp.reasons,
              ts:          Date.now(),
            };
            state.totalInvested += usdcToSpend;
            state.dailySpent = (state.dailySpent || 0) + usdcToSpend;
            saveState(state);
            console.log(`[trade] FILLED — ${shares.toFixed(1)} shares`);
            traded++;
          } else {
            console.log(`[trade] FAILED: ${result.errorMsg || JSON.stringify(result)}`);
          }

          await sleep(1000);
        }

        if (traded === 0 && opps.length > 0) {
          console.log("[trade] No new trades (already holding or budget/daily limit)");
        } else if (opps.length === 0) {
          console.log("[trade] No opportunities meet criteria this scan");
        }
      }

      // ── 4. Portfolio status ──
      const positions = Object.values(state.positions);
      const exposure = positions.reduce((s, p) => s + p.cost, 0);
      console.log(`\n[portfolio] ${positions.length}/${CFG.maxPositions} positions | $${exposure.toFixed(2)}/$${CFG.maxPortfolioUsdc} deployed | Today: $${(state.dailySpent || 0).toFixed(2)}/$${CFG.maxDailyUsdc}`);

      if (positions.length > 0) {
        for (const p of positions) {
          const age = Math.round((Date.now() - p.ts) / 3_600_000);
          console.log(`  * ${p.outcome.padEnd(12)} @ ${(p.price * 100).toFixed(0)}c  $${p.cost.toFixed(2)}  ${age}h ago  "${(p.question || "").slice(0, 40)}"`);
        }
      }

    } catch (err) {
      console.log(`[error] ${err.message}`);
      await sleep(5000);  // back off on errors
    }

    console.log(`\n[wait] Next scan in ${CFG.scanIntervalS}s…`);
    await sleep(CFG.scanIntervalS * 1000);
  }
}

process.on("SIGINT", () => { console.log("\nShutting down…"); process.exit(0); });
main().catch(e => { console.error(e); process.exit(1); });
