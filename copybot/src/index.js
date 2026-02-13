#!/usr/bin/env node
/**
 * Polymarket Copy-Trading Bot
 * Mirrors positions of a target trader and texts you on profit.
 *
 * Usage:
 *   1. cp .env.example .env   (fill in values)
 *   2. npm run approve         (one-time on-chain approvals)
 *   3. npm start               (run the bot)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ethers } from "ethers";
import { CFG } from "./config.js";
import { deriveApiKey, placeOrder, getBookPrice } from "./clob.js";
import { resolveAddress, fetchPositions, fetchMarketInfo, fetchUsdcBalance } from "./monitor.js";
import { sendSms } from "./sms.js";

const STATE_FILE = new URL("../../state.json", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─── State ────────────────────────────────────────────────── */

function loadState() {
  if (existsSync(STATE_FILE)) {
    try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { /* ignore */ }
  }
  return { copied: {}, pnl: [] };
  // copied:  { conditionId: { tokenId, side, outcome, title, costUsdc, shares, entryPrice, ts } }
  // pnl:     [ { title, outcome, profit, ts } ]
}
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

/* ─── Helpers ──────────────────────────────────────────────── */

function now() { return new Date().toLocaleString("en-US", { timeZone: "America/New_York" }); }

function log(tag, msg) { console.log(`[${now()}] [${tag}] ${msg}`); }

function diffPositions(targetPositions, copiedKeys) {
  const targetMap = new Map();
  for (const p of targetPositions) {
    const key = p.conditionId + "_" + p.asset;
    targetMap.set(key, p);
  }

  const toEnter = [];       // target has it, we don't
  const toExit  = [];       // we have it, target doesn't

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

  // ── Validate config ──
  if (!CFG.privateKey) { console.error("PRIVATE_KEY is required. See .env.example"); process.exit(1); }

  // ── Wallet setup ──
  const provider = new ethers.JsonRpcProvider(CFG.polygonRpc, 137, { staticNetwork: true });
  const wallet   = new ethers.Wallet(CFG.privateKey, provider);
  log("init", `Wallet: ${wallet.address}`);

  // ── Derive CLOB API credentials (with retry) ──
  log("init", "Deriving CLOB API credentials…");
  let creds;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      creds = await deriveApiKey(wallet);
      log("init", `API key: ${creds.apiKey.slice(0, 8)}…`);
      break;
    } catch (e) {
      log("init", `CLOB auth attempt ${attempt}/5 failed: ${e.message}`);
      if (attempt === 5) { console.error("CLOB auth failed after 5 attempts"); process.exit(1); }
      await sleep(attempt * 3000);
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

  // ── Load state ──
  const state = loadState();
  const copiedKeys = new Set(Object.keys(state.copied));
  let totalProfit = state.pnl.reduce((s, e) => s + e.profit, 0);

  log("init", `Loaded ${copiedKeys.size} copied positions, cumulative P&L: $${totalProfit.toFixed(2)}`);
  log("run", `Polling every ${CFG.pollIntervalS}s | Max per trade: $${CFG.maxTradeUsdc}`);
  console.log("─".repeat(52));

  // ── Poll loop ──
  let cycle = 0;
  while (true) {
    cycle++;
    try {
      // 1. Fetch target positions
      const targetPos = await fetchPositions(targetAddr);
      log("poll", `Target has ${targetPos.length} open positions`);

      // 2. Diff against our copies
      const { toEnter, toExit } = diffPositions(targetPos, copiedKeys);

      // 3. Copy new entries
      for (const pos of toEnter) {
        const key = pos.conditionId + "_" + pos.asset;
        const title = pos.title || pos.slug || pos.conditionId.slice(0, 12);
        const outcome = pos.outcome || "?";

        // Lookup market for negRisk flag
        const mkt = await fetchMarketInfo(pos.conditionId);
        const negRisk = mkt?.negRisk ?? false;

        // Get best price
        const price = await getBookPrice(pos.asset, "BUY");
        if (!price || price <= 0 || price >= 1) {
          log("skip", `${title} (${outcome}) – no valid price`);
          continue;
        }

        const usdcToSpend = Math.min(CFG.maxTradeUsdc, 100);  // cap
        const shares = usdcToSpend / price;

        log("copy", `BUY ${outcome} on "${title}" @ $${price.toFixed(2)} for $${usdcToSpend.toFixed(2)}`);

        const result = await placeOrder({
          wallet, creds,
          side: "BUY",
          tokenId: pos.asset,
          price,
          amount: usdcToSpend,
          negRisk,
        });

        if (result.success || result.orderID) {
          log("fill", `Order ${result.orderID || "ok"} – ${title} (${outcome})`);
          state.copied[key] = {
            tokenId: pos.asset,
            conditionId: pos.conditionId,
            outcome, title,
            costUsdc: usdcToSpend,
            shares,
            entryPrice: price,
            negRisk,
            ts: Date.now(),
          };
          copiedKeys.add(key);
          saveState(state);
        } else {
          log("err", `Order failed: ${result.errorMsg || JSON.stringify(result)}`);
        }

        await sleep(500);   // don't spam
      }

      // 4. Exit positions target no longer holds
      for (const key of toExit) {
        const entry = state.copied[key];
        if (!entry) continue;

        const price = await getBookPrice(entry.tokenId, "SELL");
        if (!price || price <= 0) {
          log("skip", `Can't sell ${entry.title} – no bid`);
          continue;
        }

        log("exit", `SELL ${entry.outcome} on "${entry.title}" @ $${price.toFixed(2)}`);

        const result = await placeOrder({
          wallet, creds,
          side: "SELL",
          tokenId: entry.tokenId,
          price,
          amount: entry.shares,
          negRisk: entry.negRisk ?? false,
        });

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
            `💰 Polymarket profit!\n` +
            `Market: ${entry.title}\n` +
            `Outcome: ${entry.outcome}\n` +
            `Profit: ${profitStr}\n` +
            `Total P&L: $${totalProfit.toFixed(2)}`
          );
        }

        await sleep(500);
      }

      // 5. Check current value of held positions for unrealized gains
      for (const [key, entry] of Object.entries(state.copied)) {
        const price = await getBookPrice(entry.tokenId, "SELL").catch(() => null);
        if (!price) continue;
        const unrealized = (entry.shares * price) - entry.costUsdc;
        entry._unrealized = unrealized;
        entry._curPrice = price;
      }
      saveState(state);

      // 6. Status display
      if (cycle % 2 === 0) {
        const held = Object.values(state.copied);
        const unrealTotal = held.reduce((s, e) => s + (e._unrealized || 0), 0);
        console.log("─".repeat(52));
        log("status", `Positions: ${held.length} | Realized P&L: $${totalProfit.toFixed(2)} | Unrealized: $${unrealTotal.toFixed(2)}`);
        for (const e of held) {
          const u = (e._unrealized ?? 0);
          const tag = u >= 0 ? "+" : "";
          console.log(`  • ${e.title} (${e.outcome}) @ $${e.entryPrice?.toFixed(2)} → $${(e._curPrice ?? 0).toFixed(2)}  ${tag}$${u.toFixed(2)}`);
        }
        console.log("─".repeat(52));
      }

    } catch (err) {
      log("err", err.message);
    }

    await sleep(CFG.pollIntervalS * 1000);
  }
}

// ── Graceful shutdown ──
process.on("SIGINT", () => {
  console.log("\nShutting down…");
  process.exit(0);
});

main().catch((e) => { console.error(e); process.exit(1); });
