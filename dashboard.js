#!/usr/bin/env node
/**
 * Polymarket Trading Dashboard
 *
 * Unified visual display for all 3 bots:
 *   - Signal Bot  (BTC 15m candles)
 *   - Copy Bot    (mirrors @anoin123)
 *   - Auto Bot    (contrarian/value strategy)
 *
 * Shows wallet balances, positions, P&L, trade reasoning, and recent activity.
 * Run:  node dashboard.js
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";
import { ethers } from "ethers";

// ── Paths ──
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const COPYBOT_STATE = path.join(ROOT, "state.json");
const AUTOBOT_STATE = path.join(ROOT, "autobot-state.json");
const SIGNAL_CSV    = path.join(ROOT, "logs", "signals.csv");
const LOGS = {
  signal: path.join(ROOT, "logs", "signal.log"),
  copy:   path.join(ROOT, "logs", "copybot.log"),
  auto:   path.join(ROOT, "logs", "autobot.log"),
};

// ── Chain config ──
const RPC_URL      = "https://polygon-bor-rpc.publicnode.com";
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const REFRESH_S    = 15;

// ── Wallet addresses ──
const WALLETS = [
  { id: "signal", label: "Signal Bot (BTC 15m)", addr: "0x5eD48e29dcd952955d7E4fccC3616EFA38cD75a5" },
  { id: "copy",   label: "Copy Bot (@anoin123)",  addr: "0xf35803f093BBceaBEb9A6abd3d4c99856BDdA40C" },
  { id: "auto",   label: "Auto Bot (Own Path)",   addr: "0xf17Cb352380Fd5503742c5A0573cDE4c656d8486" },
];

// ── ANSI ──
const A = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
  white: "\x1b[97m", gray: "\x1b[90m",
};

// ── Helpers ──
function screenW() {
  const w = Number(process.stdout?.columns);
  return Number.isFinite(w) && w >= 60 ? w : 80;
}

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ""); }
function visLen(s) { return stripAnsi(s).length; }

function pad(s, w) {
  const diff = w - visLen(s);
  return diff > 0 ? s + " ".repeat(diff) : s;
}

function center(s, w) {
  const diff = w - visLen(s);
  if (diff <= 0) return s;
  const left = Math.floor(diff / 2);
  return " ".repeat(left) + s;
}

function sep(ch = "─") { return `${A.gray}${ch.repeat(screenW())}${A.reset}`; }

function renderScreen(text) {
  try {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  } catch { /* ignore */ }
  process.stdout.write(text);
}

function nowET() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "numeric", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
}

function pnl(val) {
  if (val > 0.005)  return `${A.green}+$${val.toFixed(2)}${A.reset}`;
  if (val < -0.005) return `${A.red}-$${Math.abs(val).toFixed(2)}${A.reset}`;
  return `${A.gray}$0.00${A.reset}`;
}

function loadJson(fp) {
  try { return existsSync(fp) ? JSON.parse(readFileSync(fp, "utf8")) : null; } catch { return null; }
}

function tailFile(fp, n = 8) {
  try {
    if (!existsSync(fp)) return [];
    const lines = readFileSync(fp, "utf8").split("\n").filter(l => l.trim());
    return lines.slice(-n);
  } catch { return []; }
}

function fileAge(fp) {
  try { return existsSync(fp) ? Date.now() - statSync(fp).mtimeMs : null; } catch { return null; }
}

function isActive(logPath) {
  const age = fileAge(logPath);
  return age !== null && age < 120_000;
}

function statusDot(active) {
  return active ? `${A.green}● RUNNING${A.reset}` : `${A.red}○ STOPPED${A.reset}`;
}

// ── Balance fetcher ──
let provider, usdcContract;

function getUsdc() {
  if (!provider) provider = new ethers.JsonRpcProvider(RPC_URL, 137, { staticNetwork: true });
  if (!usdcContract) usdcContract = new ethers.Contract(USDC_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
  return usdcContract;
}

async function fetchBal(addr) {
  try { return Number(await getUsdc().balanceOf(addr)) / 1e6; } catch { return null; }
}

function fmtBal(b) { return b !== null ? `${A.white}$${b.toFixed(2)}${A.reset}` : `${A.gray}?${A.reset}`; }

// ── Signal CSV reader ──
function lastSignal() {
  try {
    if (!existsSync(SIGNAL_CSV)) return null;
    const lines = readFileSync(SIGNAL_CSV, "utf8").split("\n").filter(l => l.trim());
    if (lines.length < 2) return null;
    const header = lines[0].split(",");
    const last = lines[lines.length - 1].split(",");
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i].trim()] = (last[i] || "").trim();
    return obj;
  } catch { return null; }
}

// ── Dashboard renderer ──
async function render() {
  const w = screenW();
  const L = [];

  // ── Header ──
  L.push("");
  const boxW = Math.min(w - 2, 68);
  L.push(center(`${A.bold}${A.cyan}╔${"═".repeat(boxW)}╗${A.reset}`, w));
  L.push(center(`${A.bold}${A.cyan}║${center(`${A.white}POLYMARKET TRADING DASHBOARD`, boxW)}${A.cyan}║${A.reset}`, w));
  L.push(center(`${A.bold}${A.cyan}╚${"═".repeat(boxW)}╝${A.reset}`, w));
  L.push("");

  // ── Wallets ──
  const bals = await Promise.all(WALLETS.map(w => fetchBal(w.addr)));
  const total = bals.reduce((s, b) => s + (b ?? 0), 0);

  L.push(`  ${A.bold}${A.white}WALLETS${A.reset}                                       ${A.dim}${nowET()} ET${A.reset}`);
  L.push(`  ${sep()}`);
  for (let i = 0; i < WALLETS.length; i++) {
    const wl = WALLETS[i];
    const short = wl.addr.slice(0, 6) + "..." + wl.addr.slice(-4);
    L.push(`  ${pad(wl.label, 26)} ${A.gray}${short}${A.reset}   ${fmtBal(bals[i])} USDC`);
  }
  L.push(`  ${" ".repeat(46)}${A.bold}TOTAL: ${A.white}$${total.toFixed(2)} USDC${A.reset}`);
  L.push("");

  // ── Copy Bot ──
  const cs = loadJson(COPYBOT_STATE);
  const cPos = cs ? Object.values(cs.copied || {}) : [];
  const cExpo = cPos.reduce((s, p) => s + (p.costUsdc || 0), 0);
  const cRealized = (cs?.pnl || []).reduce((s, e) => s + (e.profit || 0), 0);
  const cUnreal = cPos.reduce((s, p) => s + (p._unrealized || 0), 0);
  const cDaily = cs?.dailySpent || 0;

  L.push(`  ${A.bold}${A.magenta}COPY BOT${A.reset} ${A.gray}(@anoin123)${A.reset}       ${cPos.length}/3 positions   ${A.yellow}$${cExpo.toFixed(2)}/$15 deployed${A.reset}`);
  L.push(`  ${sep()}`);

  if (cPos.length === 0) {
    L.push(`    ${A.gray}No open positions — waiting for @anoin123 to make a move${A.reset}`);
  } else {
    for (const p of cPos) {
      const title = (p.title || p.conditionId || "?").slice(0, 45);
      const entry = ((p.entryPrice || 0) * 100).toFixed(0);
      const cur   = ((p._curPrice  || 0) * 100).toFixed(0);
      const ur    = p._unrealized || 0;
      L.push(`    ${A.white}"${title}"${A.reset}`);
      L.push(`      ${A.bold}${p.outcome || "?"}${A.reset}  entry:${entry}c  now:${cur}c  ${pnl(ur)}`);
    }
  }
  L.push(`    ${A.dim}Daily: $${cDaily.toFixed(2)}/$10  |  Realized: ${pnl(cRealized)}  |  Unrealized: ${pnl(cUnreal)}${A.reset}`);
  L.push("");

  // ── Auto Bot ──
  const as = loadJson(AUTOBOT_STATE);
  const aPos = as ? Object.values(as.positions || {}) : [];
  const aExpo = aPos.reduce((s, p) => s + (p.cost || 0), 0);
  const aDaily = as?.dailySpent || 0;
  const aInvested = as?.totalInvested || 0;
  const aReturned = as?.totalReturned || 0;

  L.push(`  ${A.bold}${A.blue}AUTO BOT${A.reset} ${A.gray}(Own Path)${A.reset}        ${aPos.length}/3 positions   ${A.yellow}$${aExpo.toFixed(2)}/$15 deployed${A.reset}`);
  L.push(`  ${sep()}`);

  if (aPos.length === 0) {
    L.push(`    ${A.gray}No open positions — scanning for high-edge opportunities${A.reset}`);
  } else {
    for (const p of aPos) {
      const q     = (p.question || p.slug || "?").slice(0, 45);
      const entry = ((p.price || 0) * 100).toFixed(0);
      const age   = Math.round((Date.now() - (p.ts || Date.now())) / 3_600_000);
      const edge  = ((p.edge || 0) * 100).toFixed(1);
      const reasons = (p.reasons || []).join(", ");
      L.push(`    ${A.white}"${q}"${A.reset}`);
      L.push(`      ${A.bold}${p.outcome || "?"}${A.reset} @ ${entry}c  $${(p.cost || 0).toFixed(2)}  ${age}h ago  edge:${edge}%  ${A.dim}[${reasons}]${A.reset}`);
    }
  }
  L.push(`    ${A.dim}Daily: $${aDaily.toFixed(2)}/$10  |  Invested: $${aInvested.toFixed(2)}  |  Returned: $${aReturned.toFixed(2)}${A.reset}`);
  L.push("");

  // ── Signal Bot ──
  const sig = lastSignal();
  L.push(`  ${A.bold}${A.green}SIGNAL BOT${A.reset} ${A.gray}(BTC 15m)${A.reset}`);
  L.push(`  ${sep()}`);

  if (sig) {
    const regime = sig.regime || "-";
    const signal = sig.signal || "-";
    const modelUp   = sig.model_up   ? `${(Number(sig.model_up)   * 100).toFixed(0)}%` : "-";
    const modelDown = sig.model_down  ? `${(Number(sig.model_down) * 100).toFixed(0)}%` : "-";
    const mktUp     = sig.mkt_up     || "-";
    const mktDown   = sig.mkt_down   || "-";
    const edgeUp    = sig.edge_up    ? `${(Number(sig.edge_up)    * 100).toFixed(1)}%` : "-";
    const edgeDown  = sig.edge_down  ? `${(Number(sig.edge_down)  * 100).toFixed(1)}%` : "-";
    const rec       = sig.recommendation || "-";
    const timeLeft  = sig.time_left_min ? `${Number(sig.time_left_min).toFixed(1)}m` : "-";

    const signalColor = signal === "BUY UP" ? A.green : signal === "BUY DOWN" ? A.red : A.gray;

    L.push(`    Regime: ${A.white}${regime}${A.reset}  |  Time left: ${A.white}${timeLeft}${A.reset}  |  Signal: ${signalColor}${signal}${A.reset}`);
    L.push(`    Model: ${A.green}UP ${modelUp}${A.reset} / ${A.red}DOWN ${modelDown}${A.reset}  |  Market: ${A.green}UP ${mktUp}${A.reset} / ${A.red}DOWN ${mktDown}${A.reset}`);
    L.push(`    Edge: UP ${edgeUp} / DOWN ${edgeDown}  |  Rec: ${A.bold}${rec}${A.reset}`);
  } else {
    L.push(`    ${A.gray}No signal data yet — waiting for first candle window${A.reset}`);
  }
  L.push("");

  // ── Status indicators ──
  const sActive = isActive(LOGS.signal);
  const cActive = isActive(LOGS.copy);
  const aActive = isActive(LOGS.auto);

  L.push(`  ${A.bold}${A.white}BOT STATUS${A.reset}`);
  L.push(`  ${sep()}`);
  L.push(`    Signal: ${statusDot(sActive)}   Copy: ${statusDot(cActive)}   Auto: ${statusDot(aActive)}`);
  L.push("");

  // ── Safeguards summary ──
  L.push(`  ${A.bold}${A.white}SAFEGUARDS${A.reset} ${A.dim}(tuned for $20 wallets)${A.reset}`);
  L.push(`  ${sep()}`);
  L.push(`    Per trade: ${A.white}$5${A.reset} max  |  Portfolio: ${A.white}$15${A.reset} cap  |  Positions: ${A.white}3${A.reset} max`);
  L.push(`    Daily cap: ${A.white}$10/day${A.reset}  |  Spread: ${A.white}5c${A.reset} max   |  Min edge: ${A.white}12%${A.reset} (auto)`);
  L.push("");

  // ── Recent Activity ──
  L.push(`  ${A.bold}${A.white}RECENT ACTIVITY${A.reset}`);
  L.push(`  ${sep()}`);

  const activity = [];
  for (const [bot, logPath] of Object.entries(LOGS)) {
    const lines = tailFile(logPath, 6);
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      // Skip decorative lines
      if (/^[─═╔╚║\s]*$/.test(stripAnsi(t))) continue;
      if (t.length < 10) continue;
      const prefix = bot === "signal" ? `${A.green}[SIG]${A.reset}`
                   : bot === "copy"   ? `${A.magenta}[CPY]${A.reset}`
                   :                    `${A.blue}[AUT]${A.reset}`;
      activity.push(`    ${prefix} ${A.dim}${stripAnsi(t).slice(0, w - 14)}${A.reset}`);
    }
  }

  const show = activity.slice(-10);
  if (show.length === 0) {
    L.push(`    ${A.gray}No activity yet — bots may still be starting up${A.reset}`);
  } else {
    L.push(...show);
  }
  L.push("");

  // ── Footer ──
  L.push(sep("═"));
  L.push(center(`${A.dim}Refreshing every ${REFRESH_S}s  |  Ctrl+C to close dashboard (bots keep running)${A.reset}`, w));
  L.push(center(`${A.dim}created by @krajekis${A.reset}`, w));

  renderScreen(L.join("\n") + "\n");
}

// ── Main ──
async function main() {
  console.clear();
  console.log(`${A.cyan}Loading Polymarket Dashboard...${A.reset}`);

  while (true) {
    try {
      await render();
    } catch (err) {
      // Don't crash dashboard on transient errors
      try {
        readline.cursorTo(process.stdout, 0, process.stdout.rows - 2);
        process.stdout.write(`${A.red}Dashboard error: ${err.message}${A.reset}\n`);
      } catch { /* ignore */ }
    }
    await new Promise(r => setTimeout(r, REFRESH_S * 1000));
  }
}

process.on("SIGINT", () => { console.clear(); process.exit(0); });
main();
