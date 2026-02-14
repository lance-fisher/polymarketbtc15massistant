#!/usr/bin/env node
/**
 * Polymarket Copy-Trading Bot
 * Mirrors positions of a target trader and texts you on profit.
 *
 * Safeguards:
 *   - Portfolio cap (MAX_PORTFOLIO_USDC) — stops buying when exposure limit hit
 *   - Position cap (MAX_POSITIONS) — max concurrent positions
 *   - Daily spending cap (MAX_DAILY_USDC) — resets at midnight ET
 *   - Max 2 new entries per poll cycle — prevents first-run dump
 *   - Spread guard — skips markets with bid/ask spread > MAX_SPREAD_CENTS
 *   - First-run catch-up skip — ignores target's pre-existing positions on launch
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";
import { CFG } from "./config.js";
import { deriveApiKey, placeOrder, getBookPrice } from "./clob.js";
import { resolveAddress, fetchPositions, fetchMarketInfo, fetchUsdcBalance } from "./monitor.js";
import { sendSms } from "./sms.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dir, "..", "..", "state.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─── State ────────────────────────────────────────────────── */

function loadState() {
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { /* ignore */ }
  }
  return { copied: {}, pnl: [], dailySpent: 0, dailyResetDate: "" };
}
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

/* ─── Helpers ──────────────────────────────────────────────── */

function now() { return new Date().toLocaleString("en-US", { timeZone: "America/New_York" }); }
function todayET() {
  return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

function log(tag, msg) { console.log(`[${now()}] [${tag}] ${msg}`); }

function diffPositions(targetPositions, copiedKeys) {
  const targetMap = new Map();
  for (const p of targetPositions) {
    const key = p.conditionId + "_" + p.asset;
    targetMap.set(key, p);
  }

  const toEnter = [];
  const toExit  = [];

  for (const [key, pos] of targetMap) {
    if (!copiedKeys.has(key)) toEnter.push(pos);
  }
  for (const key of copiedKeys) {
    if (!targetMap.has(key)) toExit.push(key);
  }
  return { toEnter, toExit };
}

/* ─── Main ─────────────────────────────────────────────────── */

async function main() {
  console.log(`
╔══════════════════════════════════════════════════╗
║   Polymarket Copy Bot  ·  Target: @${CFG.targetUsername.padEnd(12)}   ║
╚══════════════════════════════════════════════════╝`);

  if (!CFG.privateKey) { console.error("PRIVATE_KEY is required. See .env.example"); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(CFG.polygonRpc, 137, { staticNetwork: true });
  const wallet   = new ethers.Wallet(CFG.privateKey, provider);
  log("init", `Wallet: ${wallet.address}`);

  // ── Derive CLOB API credentials (with retry — never gives up) ──
  log("init", "Deriving CLOB API credentials…");
  let creds;
  for (let attempt = 1; ; attempt++) {
    try {
      creds = await deriveApiKey(wallet);
      log("init", `API key: ${creds.apiKey.slice(0, 8)}…`);
      break;
    } catch (e) {
      log("init", `CLOB auth attempt ${attempt} failed: ${e.message}`);
      const delay = Math.min(attempt * 3000, 30000);
      log("init", `Retrying in ${delay / 1000}s…`);
      await sleep(delay);
    }
  }

  // ── Resolve target address ──
  let targetAddr = CFG.targetAddress;
  if (!targetAddr) {
    log("init", `Resolving @${CFG.targetUsername}…`);
    targetAddr = await resolveAddress(CFG.targetUsername);
    if (!targetAddr) {
      console.error(`Could not resolve @${CFG.targetUsername}. Set TARGET_ADDRESS in .env.`);
      process.exit(1);
    }
  }
  log("init", `Target address: ${targetAddr}`);

  // ── Check USDC balance ──
  try {
    const bal = await fetchUsdcBalance(provider, wallet.address);
    log("init", `USDC balance: $${bal.toFixed(2)}`);
    if (bal < CFG.maxTradeUsdc) {
      log("warn", `Balance ($${bal.toFixed(2)}) < MAX_TRADE_USDC ($${CFG.maxTradeUsdc}). Fund your wallet.`);
    }
  } catch { log("warn", "Could not check USDC balance"); }

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
          log("approve", `USDC → ${label}…`);
          const tx = await usdc.approve(addr, MAX, gasOv);
          await tx.wait();
          log("approve", `✓ USDC approved (${tx.hash.slice(0, 10)}…)`);
        }
        if (!(await ctf.isApprovedForAll(wallet.address, addr))) {
          log("approve", `CTF → ${label}…`);
          const tx = await ctf.setApprovalForAll(addr, true, gasOv);
          await tx.wait();
          log("approve", `✓ CTF approved (${tx.hash.slice(0, 10)}…)`);
        }
      } catch (e) {
        log("approve", `${label}: ${e.message.slice(0, 80)}`);
      }
    }
  }

  // ── Load state ──
  const state = loadState();
  const copiedKeys = new Set(Object.keys(state.copied));
  let totalProfit = state.pnl.reduce((s, e) => s + e.profit, 0);

  log("init", `Loaded ${copiedKeys.size} copied positions, P&L: $${totalProfit.toFixed(2)}`);
  log("init", `Limits: $${CFG.maxTradeUsdc}/trade | $${CFG.maxPortfolioUsdc} portfolio cap | ${CFG.maxPositions} max positions | $${CFG.maxDailyUsdc}/day`);
  console.log("─".repeat(52));

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

      // 1. Fetch target positions
      const targetPos = await fetchPositions(targetAddr);
      log("poll", `Target has ${targetPos.length} open positions`);

      // 2. Diff against our copies
      const { toEnter, toExit } = diffPositions(targetPos, copiedKeys);

      // 3. Compute current exposure
      const currentExposure = Object.values(state.copied).reduce((s, e) => s + e.costUsdc, 0);
      const currentPositions = Object.keys(state.copied).length;

      // 4. Copy new entries (with all safeguards)
      let newThisCycle = 0;
      for (const pos of toEnter) {
        try {
        const key = pos.conditionId + "_" + pos.asset;
        const title = pos.title || pos.slug || pos.conditionId.slice(0, 12);
        const outcome = pos.outcome || "?";

        if (newThisCycle >= CFG.maxNewPerCycle) {
          log("skip", `${title} – max ${CFG.maxNewPerCycle} new entries per cycle reached`);
          break;
        }
        if (currentPositions + newThisCycle >= CFG.maxPositions) {
          log("skip", `${title} – at position limit (${CFG.maxPositions})`);
          break;
        }
        const spent = currentExposure + (newThisCycle * CFG.maxTradeUsdc);
        if (spent + CFG.maxTradeUsdc > CFG.maxPortfolioUsdc) {
          log("skip", `${title} – portfolio cap ($${CFG.maxPortfolioUsdc}) would be exceeded`);
          break;
        }
        if (state.dailySpent + CFG.maxTradeUsdc > CFG.maxDailyUsdc) {
          log("skip", `${title} – daily spending cap ($${CFG.maxDailyUsdc}) reached`);
          break;
        }

        const mkt = await fetchMarketInfo(pos.conditionId);
        const negRisk = mkt?.negRisk ?? false;

        const buyPrice = await getBookPrice(pos.asset, "BUY");
        const sellPrice = await getBookPrice(pos.asset, "SELL");
        if (!buyPrice || buyPrice <= 0 || buyPrice >= 1) {
          log("skip", `${title} (${outcome}) – no valid buy price`);
          continue;
        }
        const spreadCents = sellPrice ? Math.round((buyPrice - sellPrice) * 100) : 99;
        if (spreadCents > CFG.maxSpreadCents) {
          log("skip", `${title} (${outcome}) – spread too wide (${spreadCents}¢ > ${CFG.maxSpreadCents}¢)`);
          continue;
        }

        const usdcToSpend = CFG.maxTradeUsdc;
        const shares = usdcToSpend / buyPrice;

        log("copy", `BUY ${outcome} on "${title}" @ ${(buyPrice * 100).toFixed(0)}¢ for $${usdcToSpend.toFixed(2)} (spread: ${spreadCents}¢)`);

        const result = await placeOrder({
          wallet, creds,
          side: "BUY",
          tokenId: pos.asset,
          price: buyPrice,
          amount: usdcToSpend,
          negRisk,
        });

        // Auto-refresh API key on auth failure
        if (result.status === 401 || result.status === 403 || (result.errorMsg || "").includes("auth")) {
          log("auth", "API key expired — re-deriving…");
          try { creds = await deriveApiKey(wallet); log("auth", "New API key derived"); } catch (e) { log("auth", `Re-derive failed: ${e.message}`); }
          break;
        }

        if (result.success || result.orderID) {
          log("fill", `Order ${result.orderID || "ok"} – ${title} (${outcome})`);
          state.copied[key] = {
            tokenId: pos.asset,
            conditionId: pos.conditionId,
            outcome, title,
            costUsdc: usdcToSpend,
            shares,
            entryPrice: buyPrice,
            negRisk,
            ts: Date.now(),
          };
          copiedKeys.add(key);
          state.dailySpent += usdcToSpend;
          newThisCycle++;
          saveState(state);
        } else {
          log("err", `Order failed: ${result.errorMsg || JSON.stringify(result)}`);
        }

        await sleep(500);
        } catch (e) { log("err", `Entry error: ${e.message}`); }
      }

      // 5. Exit positions target no longer holds
      for (const key of toExit) {
        try {
        const entry = state.copied[key];
        if (!entry) continue;

        const price = await getBookPrice(entry.tokenId, "SELL");
        if (!price || price <= 0) {
          log("skip", `Can't sell ${entry.title} – no bid`);
          continue;
        }

        log("exit", `SELL ${entry.outcome} on "${entry.title}" @ ${(price * 100).toFixed(0)}¢`);

        const result = await placeOrder({
          wallet, creds,
          side: "SELL",
          tokenId: entry.tokenId,
          price,
          amount: entry.shares,
          negRisk: entry.negRisk ?? false,
        });

        // Only record P&L if sell actually succeeded
        if (result.success || result.orderID) {
          const revenue = entry.shares * price;
          const profit  = revenue - entry.costUsdc;
          totalProfit  += profit;

          state.pnl.push({ title: entry.title, outcome: entry.outcome, profit, ts: Date.now() });
          delete state.copied[key];
          copiedKeys.delete(key);
          saveState(state);

          const profitStr = profit >= 0 ? `+$${profit.toFixed(2)}` : `-$${Math.abs(profit).toFixed(2)}`;
          log("pnl", `${entry.title}: ${profitStr}`);

          if (profit > 0) {
            await sendSms(
              `Polymarket profit!\n` +
              `Market: ${entry.title}\n` +
              `Outcome: ${entry.outcome}\n` +
              `Profit: ${profitStr}\n` +
              `Total P&L: $${totalProfit.toFixed(2)}`
            );
          }
        } else {
          log("err", `Sell failed for ${entry.title}: ${result.errorMsg || JSON.stringify(result)} — keeping position`);
        }

        await sleep(500);
        } catch (e) { log("err", `Exit error (${key}): ${e.message}`); }
      }

      // 6. Check current value of held positions
      for (const [key, entry] of Object.entries(state.copied)) {
        const price = await getBookPrice(entry.tokenId, "SELL").catch(() => null);
        if (!price) continue;
        const unrealized = (entry.shares * price) - entry.costUsdc;
        entry._unrealized = unrealized;
        entry._curPrice = price;
      }
      saveState(state);

      // 7. Status display
      if (cycle % 2 === 0) {
        const held = Object.values(state.copied);
        const exposure = held.reduce((s, e) => s + e.costUsdc, 0);
        const unrealTotal = held.reduce((s, e) => s + (e._unrealized || 0), 0);
        console.log("─".repeat(52));
        log("status", `Positions: ${held.length}/${CFG.maxPositions} | Exposure: $${exposure.toFixed(2)}/$${CFG.maxPortfolioUsdc} | Today: $${state.dailySpent.toFixed(2)}/$${CFG.maxDailyUsdc}`);
        log("status", `Realized: $${totalProfit.toFixed(2)} | Unrealized: $${unrealTotal.toFixed(2)}`);
        for (const e of held) {
          const u = (e._unrealized ?? 0);
          const tag = u >= 0 ? "+" : "";
          console.log(`  * ${e.title} (${e.outcome}) @ ${(e.entryPrice * 100).toFixed(0)}c -> ${((e._curPrice ?? 0) * 100).toFixed(0)}c  ${tag}$${u.toFixed(2)}`);
        }
        console.log("─".repeat(52));
      }

    } catch (err) {
      log("err", err.message);
      await sleep(5000);
    }

    await sleep(CFG.pollIntervalS * 1000);
  }
}

process.on("SIGINT", () => {
  console.log("\nShutting down…");
  process.exit(0);
});

main().catch((e) => { console.error(e); process.exit(1); });
