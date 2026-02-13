#!/usr/bin/env node
/**
 * Polymarket Web Dashboard
 * Opens in your browser — no terminal needed.
 * Run: node web-dashboard.js
 */
import http from "node:http";
import { readFileSync, existsSync, statSync, createWriteStream, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { exec, spawn } from "node:child_process";
import { ethers } from "ethers";

const PORT = 3847;
const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ── Paths ──
const COPYBOT_STATE = path.join(ROOT, "state.json");
const AUTOBOT_STATE = path.join(ROOT, "autobot-state.json");
const SIGNAL_CSV    = path.join(ROOT, "logs", "signals.csv");
const LOGS = {
  signal: path.join(ROOT, "logs", "signal.log"),
  copy:   path.join(ROOT, "logs", "copybot.log"),
  auto:   path.join(ROOT, "logs", "autobot.log"),
};

// ── Chain ──
const RPC_URLS = [
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.llamarpc.com",
  "https://polygon-mainnet.public.blastapi.io",
  "https://1rpc.io/matic",
];
// USDC.e (bridged, used by Polymarket) + native USDC
const USDC_BRIDGED = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_NATIVE  = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const WALLETS = [
  { id: "signal", label: "Signal Bot (BTC 15m)", addr: "0x5eD48e29dcd952955d7E4fccC3616EFA38cD75a5" },
  { id: "copy",   label: "Copy Bot (@anoin123)",  addr: "0xf35803f093BBceaBEb9A6abd3d4c99856BDdA40C" },
  { id: "auto",   label: "Auto Bot (Own Path)",   addr: "0xf17Cb352380Fd5503742c5A0573cDE4c656d8486" },
];

const ABI = ["function balanceOf(address) view returns (uint256)"];
let provider, usdcBridged, usdcNative, rpcIndex = 0;

function getProvider() {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(RPC_URLS[rpcIndex], 137, { staticNetwork: true });
  }
  return provider;
}

function rotateRpc() {
  rpcIndex = (rpcIndex + 1) % RPC_URLS.length;
  provider = new ethers.JsonRpcProvider(RPC_URLS[rpcIndex], 137, { staticNetwork: true });
  usdcBridged = new ethers.Contract(USDC_BRIDGED, ABI, provider);
  usdcNative  = new ethers.Contract(USDC_NATIVE, ABI, provider);
  console.log(`  [rpc] Switched to ${RPC_URLS[rpcIndex]}`);
}

function getContracts() {
  const p = getProvider();
  if (!usdcBridged) usdcBridged = new ethers.Contract(USDC_BRIDGED, ABI, p);
  if (!usdcNative)  usdcNative  = new ethers.Contract(USDC_NATIVE, ABI, p);
  return { usdcBridged, usdcNative };
}

async function fetchBal(addr) {
  for (let attempt = 0; attempt < RPC_URLS.length; attempt++) {
    try {
      const { usdcBridged: ub, usdcNative: un } = getContracts();
      const [bridged, native] = await Promise.all([
        ub.balanceOf(addr),
        un.balanceOf(addr),
      ]);
      return (Number(bridged) + Number(native)) / 1e6;
    } catch {
      rotateRpc();
    }
  }
  return null;
}

// ── Bot Process Management ──
const BRANCH = "claude/polymarket-copy-bot-xcdOo";
const BOT_DEFS = [
  { name: "CopyBot",   cwd: path.join(ROOT, "copybot"), envFile: path.join(ROOT, "copybot", ".env"), script: path.join("src", "index.js"), logKey: "copy" },
  { name: "SignalBot",  cwd: ROOT,                       envFile: path.join(ROOT, ".env"),             script: path.join("src", "index.js"), logKey: "signal" },
  { name: "AutoBot",    cwd: path.join(ROOT, "autobot"), envFile: path.join(ROOT, "autobot", ".env"), script: path.join("src", "index.js"), logKey: "auto" },
];
const botProcs = [];

function loadEnvFile(fp) {
  const env = { ...process.env };
  try {
    if (!existsSync(fp)) return env;
    for (const line of readFileSync(fp, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  } catch {}
  return env;
}

function spawnBot(def) {
  if (!existsSync(def.envFile)) { console.log(`  [bot] ${def.name} skipped (no .env)`); return null; }
  const env = loadEnvFile(def.envFile);
  const logStream = createWriteStream(LOGS[def.logKey], { flags: "a" });
  const proc = spawn("node", [def.script], { cwd: def.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.pipe(logStream);
  proc.stderr.pipe(logStream);
  const entry = { name: def.name, proc, def, restarts: 0, logStream };
  proc.on("exit", (code) => {
    console.log(`  [bot] ${def.name} exited (code ${code})`);
    try { logStream.end(); } catch {}
    if (entry.restarts < 50) {
      const delay = Math.min(5000 + entry.restarts * 2000, 60000);
      console.log(`  [bot] ${def.name} will restart in ${delay / 1000}s (restart #${entry.restarts + 1})`);
      setTimeout(() => {
        entry.restarts++;
        const idx = botProcs.indexOf(entry);
        if (idx >= 0) botProcs.splice(idx, 1);
        const newEntry = spawnBot(def);
        if (newEntry) newEntry.restarts = entry.restarts;
      }, delay);
    } else {
      console.log(`  [bot] ${def.name} exceeded restart limit — giving up`);
    }
  });
  botProcs.push(entry);
  console.log(`  [bot] ${def.name} started (pid ${proc.pid})`);
  return entry;
}

function spawnBots() {
  if (!existsSync(path.join(ROOT, "logs"))) mkdirSync(path.join(ROOT, "logs"), { recursive: true });
  for (const def of BOT_DEFS) {
    spawnBot(def);
  }
}

function killBots() {
  for (const { name, proc } of botProcs) {
    try { proc.kill(); console.log(`  [bot] ${name} stopped`); } catch {}
  }
  botProcs.length = 0;
}

// ── Auto-Update from Git ──
let lastUpdateCheck = null;
let updateStatus = "idle";

function checkForUpdates() {
  exec(`git fetch origin ${BRANCH}`, { cwd: ROOT, timeout: 15000 }, (err) => {
    if (err) { updateStatus = "fetch-error"; return; }
    exec("git rev-parse HEAD", { cwd: ROOT }, (err, localHash) => {
      if (err) return;
      exec(`git rev-parse origin/${BRANCH}`, { cwd: ROOT }, (err, remoteHash) => {
        if (err) return;
        lastUpdateCheck = new Date();
        if (localHash.trim() !== remoteHash.trim()) {
          updateStatus = "updating";
          console.log("\n  [update] New code detected! Pulling...");
          exec(`git pull origin ${BRANCH}`, { cwd: ROOT, timeout: 30000 }, (pullErr) => {
            if (pullErr) { console.log("  [update] Pull failed:", pullErr.message); updateStatus = "pull-error"; return; }
            console.log("  [update] Updated! Restarting everything...\n");
            killBots();
            setTimeout(() => process.exit(0), 2000);
          });
        } else {
          updateStatus = "up-to-date";
        }
      });
    });
  });
}

// ── Helpers ──
function loadJson(fp) {
  try { return existsSync(fp) ? JSON.parse(readFileSync(fp, "utf8")) : null; } catch { return null; }
}

function tailFile(fp, n = 15) {
  try {
    if (!existsSync(fp)) return [];
    const lines = readFileSync(fp, "utf8").split("\n").filter(l => l.trim());
    return lines.slice(-n);
  } catch { return []; }
}

function fileAge(fp) {
  try { return existsSync(fp) ? Date.now() - statSync(fp).mtimeMs : null; } catch { return null; }
}

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

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ""); }

async function getStatus() {
  const bals = await Promise.all(WALLETS.map(w => fetchBal(w.addr)));

  const cs = loadJson(COPYBOT_STATE);
  const cPos = cs ? Object.values(cs.copied || {}) : [];
  const cRealized = (cs?.pnl || []).reduce((s, e) => s + (e.profit || 0), 0);
  const cUnreal = cPos.reduce((s, p) => s + (p._unrealized || 0), 0);

  const as = loadJson(AUTOBOT_STATE);
  const aPos = as ? Object.values(as.positions || {}) : [];

  const sig = lastSignal();

  const activity = [];
  for (const [bot, logPath] of Object.entries(LOGS)) {
    for (const line of tailFile(logPath, 8)) {
      const t = stripAnsi(line).trim();
      if (!t || /^[─═╔╚║\s]*$/.test(t) || t.length < 10) continue;
      activity.push({ bot, line: t });
    }
  }

  return {
    time: new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour12: true }),
    wallets: WALLETS.map((w, i) => ({ ...w, balance: bals[i] })),
    total: bals.reduce((s, b) => s + (b ?? 0), 0),
    copy: {
      positions: cPos.map(p => ({
        title: (p.title || p.conditionId || "?").slice(0, 50),
        outcome: p.outcome || "?",
        entryPrice: p.entryPrice || 0,
        curPrice: p._curPrice || 0,
        cost: p.costUsdc || 0,
        unrealized: p._unrealized || 0,
      })),
      realized: cRealized,
      unrealized: cUnreal,
      exposure: cPos.reduce((s, p) => s + (p.costUsdc || 0), 0),
      dailySpent: cs?.dailySpent || 0,
      active: fileAge(LOGS.copy) !== null && fileAge(LOGS.copy) < 120000,
    },
    auto: {
      positions: aPos.map(p => ({
        question: (p.question || p.slug || "?").slice(0, 50),
        outcome: p.outcome || "?",
        price: p.price || 0,
        cost: p.cost || 0,
        edge: p.edge || 0,
        reasons: p.reasons || [],
        age: Math.round((Date.now() - (p.ts || Date.now())) / 3600000),
      })),
      invested: as?.totalInvested || 0,
      returned: as?.totalReturned || 0,
      exposure: aPos.reduce((s, p) => s + (p.cost || 0), 0),
      dailySpent: as?.dailySpent || 0,
      active: fileAge(LOGS.auto) !== null && fileAge(LOGS.auto) < 120000,
    },
    signal: {
      data: sig,
      active: fileAge(LOGS.signal) !== null && fileAge(LOGS.signal) < 120000,
    },
    activity: activity.slice(-20),
    updateStatus,
    lastUpdateCheck: lastUpdateCheck ? lastUpdateCheck.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: true }) : null,
  };
}

// ── HTML ──
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Polymarket Trading Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #0a0e17; color: #e0e0e0; min-height: 100vh; }
  .header { background: linear-gradient(135deg, #1a1f2e, #0d1117); border-bottom: 1px solid #30363d; padding: 20px 30px; text-align: center; }
  .header h1 { font-size: 22px; color: #58a6ff; letter-spacing: 1px; }
  .header .time { color: #8b949e; font-size: 13px; margin-top: 4px; }
  .header .status-row { margin-top: 8px; display: flex; justify-content: center; gap: 20px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
  .dot.on { background: #3fb950; box-shadow: 0 0 6px #3fb950; }
  .dot.off { background: #f85149; }
  .container { max-width: 1100px; margin: 0 auto; padding: 20px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 18px; }
  .card h3 { font-size: 13px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
  .card .addr { font-family: monospace; font-size: 11px; color: #58a6ff; word-break: break-all; }
  .card .bal { font-size: 28px; font-weight: 700; color: #e6edf3; margin: 6px 0; }
  .card .bal .usd { color: #8b949e; font-size: 14px; font-weight: 400; }
  .total-bar { background: linear-gradient(90deg, #1f6feb22, #1a1f2e); border: 1px solid #1f6feb44; border-radius: 8px; padding: 14px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
  .total-bar .label { color: #8b949e; font-size: 14px; }
  .total-bar .value { font-size: 24px; font-weight: 700; color: #58a6ff; }
  .section { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; margin-bottom: 16px; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
  .section-header h2 { font-size: 16px; font-weight: 600; }
  .section-header .badge { font-size: 11px; padding: 3px 10px; border-radius: 12px; font-weight: 600; }
  .badge.copy { background: #8b5cf622; color: #a78bfa; border: 1px solid #8b5cf644; }
  .badge.auto { background: #3b82f622; color: #60a5fa; border: 1px solid #3b82f644; }
  .badge.signal { background: #22c55e22; color: #4ade80; border: 1px solid #22c55e44; }
  .pos-table { width: 100%; border-collapse: collapse; }
  .pos-table th { text-align: left; font-size: 11px; color: #8b949e; text-transform: uppercase; padding: 6px 8px; border-bottom: 1px solid #21262d; }
  .pos-table td { padding: 8px; font-size: 13px; border-bottom: 1px solid #21262d11; }
  .pos-table tr:hover td { background: #1c2128; }
  .green { color: #3fb950; }
  .red { color: #f85149; }
  .gray { color: #8b949e; }
  .tag { display: inline-block; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #30363d; color: #8b949e; margin-left: 3px; }
  .stats-row { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px solid #21262d; }
  .stat { font-size: 12px; color: #8b949e; }
  .stat b { color: #e6edf3; }
  .signal-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .signal-item { text-align: center; padding: 10px; background: #0d1117; border-radius: 8px; }
  .signal-item .label { font-size: 11px; color: #8b949e; margin-bottom: 4px; }
  .signal-item .value { font-size: 18px; font-weight: 700; }
  .activity { max-height: 280px; overflow-y: auto; }
  .activity-line { font-family: monospace; font-size: 12px; padding: 4px 8px; border-left: 3px solid #30363d; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #8b949e; }
  .activity-line.copy { border-left-color: #8b5cf6; }
  .activity-line.auto { border-left-color: #3b82f6; }
  .activity-line.signal { border-left-color: #22c55e; }
  .activity-line .bot-tag { font-weight: 700; margin-right: 6px; }
  .empty { color: #484f58; font-style: italic; padding: 20px; text-align: center; }
  .safeguards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .sg-item { background: #0d1117; border-radius: 6px; padding: 8px 12px; text-align: center; }
  .sg-item .sg-val { font-size: 18px; font-weight: 700; color: #e6edf3; }
  .sg-item .sg-label { font-size: 10px; color: #8b949e; text-transform: uppercase; }
  .refresh-bar { text-align: center; color: #484f58; font-size: 11px; padding: 10px; }
  .update-bar { text-align: center; font-size: 11px; padding: 6px; background: #0d1117; border-bottom: 1px solid #21262d; }
  .update-bar .up { color: #3fb950; }
  .update-bar .err { color: #f85149; }
  .update-bar .busy { color: #d29922; }
  .footer { text-align: center; padding: 20px; color: #30363d; font-size: 12px; }
</style>
</head>
<body>

<div class="header">
  <h1>POLYMARKET TRADING DASHBOARD</h1>
  <div class="time" id="time"></div>
  <div class="status-row" id="statusRow"></div>
</div>
<div class="update-bar" id="updateBar"></div>

<div class="container">
  <div class="grid" id="wallets"></div>
  <div class="total-bar">
    <span class="label">Total Portfolio</span>
    <span class="value" id="total">...</span>
  </div>

  <div class="section">
    <div class="section-header">
      <h2>Copy Bot <span class="badge copy">@anoin123</span></h2>
      <span id="copyCount" class="gray"></span>
    </div>
    <div id="copyPositions"></div>
    <div class="stats-row" id="copyStats"></div>
  </div>

  <div class="section">
    <div class="section-header">
      <h2>Auto Bot <span class="badge auto">Own Path</span></h2>
      <span id="autoCount" class="gray"></span>
    </div>
    <div id="autoPositions"></div>
    <div class="stats-row" id="autoStats"></div>
  </div>

  <div class="section">
    <div class="section-header">
      <h2>Signal Bot <span class="badge signal">BTC 15m</span></h2>
    </div>
    <div id="signalData"></div>
  </div>

  <div class="section">
    <div class="section-header">
      <h2>Safeguards</h2>
      <span class="gray" style="font-size:12px">tuned for $20 wallets</span>
    </div>
    <div class="safeguards">
      <div class="sg-item"><div class="sg-val">$5</div><div class="sg-label">Per Trade</div></div>
      <div class="sg-item"><div class="sg-val">$15</div><div class="sg-label">Portfolio Cap</div></div>
      <div class="sg-item"><div class="sg-val">3</div><div class="sg-label">Max Positions</div></div>
      <div class="sg-item"><div class="sg-val">$10/d</div><div class="sg-label">Daily Cap</div></div>
      <div class="sg-item"><div class="sg-val">5c</div><div class="sg-label">Max Spread</div></div>
      <div class="sg-item"><div class="sg-val">12%</div><div class="sg-label">Min Edge (Auto)</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-header"><h2>Recent Activity</h2></div>
    <div class="activity" id="activity"></div>
  </div>

  <div class="refresh-bar">Dashboard refreshes every 10s · Code auto-updates from git every 60s · Bots managed by dashboard</div>
  <div class="footer">created by @krajekis</div>
</div>

<script>
function pnl(v) {
  if (v > 0.005) return '<span class="green">+$' + v.toFixed(2) + '</span>';
  if (v < -0.005) return '<span class="red">-$' + Math.abs(v).toFixed(2) + '</span>';
  return '<span class="gray">$0.00</span>';
}

function pct(v) { return (v * 100).toFixed(1) + '%'; }

async function refresh() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();

    document.getElementById('time').textContent = d.time + ' ET';

    // Status dots
    document.getElementById('statusRow').innerHTML =
      '<span><span class="dot ' + (d.signal.active ? 'on' : 'off') + '"></span>Signal</span>' +
      '<span><span class="dot ' + (d.copy.active ? 'on' : 'off') + '"></span>Copy</span>' +
      '<span><span class="dot ' + (d.auto.active ? 'on' : 'off') + '"></span>Auto</span>';

    // Wallets
    document.getElementById('wallets').innerHTML = d.wallets.map(w =>
      '<div class="card"><h3>' + w.label + '</h3>' +
      '<div class="bal">' + (w.balance !== null ? '$' + w.balance.toFixed(2) : '?') + ' <span class="usd">USDC</span></div>' +
      '<div class="addr">' + w.addr + '</div></div>'
    ).join('');

    document.getElementById('total').textContent = '$' + d.total.toFixed(2) + ' USDC';

    // Copy Bot
    document.getElementById('copyCount').textContent = d.copy.positions.length + '/3 positions | $' + d.copy.exposure.toFixed(2) + '/$15 deployed';
    if (d.copy.positions.length === 0) {
      document.getElementById('copyPositions').innerHTML = '<div class="empty">No open positions — waiting for @anoin123</div>';
    } else {
      let html = '<table class="pos-table"><tr><th>Market</th><th>Side</th><th>Entry</th><th>Now</th><th>P&L</th></tr>';
      d.copy.positions.forEach(p => {
        html += '<tr><td>' + p.title + '</td><td>' + p.outcome + '</td><td>' + (p.entryPrice * 100).toFixed(0) + 'c</td><td>' + (p.curPrice * 100).toFixed(0) + 'c</td><td>' + pnl(p.unrealized) + '</td></tr>';
      });
      html += '</table>';
      document.getElementById('copyPositions').innerHTML = html;
    }
    document.getElementById('copyStats').innerHTML =
      '<span class="stat">Daily: <b>$' + d.copy.dailySpent.toFixed(2) + '/$10</b></span>' +
      '<span class="stat">Realized: <b>' + pnl(d.copy.realized) + '</b></span>' +
      '<span class="stat">Unrealized: <b>' + pnl(d.copy.unrealized) + '</b></span>';

    // Auto Bot
    document.getElementById('autoCount').textContent = d.auto.positions.length + '/3 positions | $' + d.auto.exposure.toFixed(2) + '/$15 deployed';
    if (d.auto.positions.length === 0) {
      document.getElementById('autoPositions').innerHTML = '<div class="empty">No open positions — scanning for opportunities</div>';
    } else {
      let html = '<table class="pos-table"><tr><th>Market</th><th>Side</th><th>Entry</th><th>Cost</th><th>Edge</th><th>Age</th><th>Reasoning</th></tr>';
      d.auto.positions.forEach(p => {
        const tags = p.reasons.map(r => '<span class="tag">' + r + '</span>').join('');
        html += '<tr><td>' + p.question + '</td><td>' + p.outcome + '</td><td>' + (p.price * 100).toFixed(0) + 'c</td><td>$' + p.cost.toFixed(2) + '</td><td>' + pct(p.edge) + '</td><td>' + p.age + 'h</td><td>' + tags + '</td></tr>';
      });
      html += '</table>';
      document.getElementById('autoPositions').innerHTML = html;
    }
    document.getElementById('autoStats').innerHTML =
      '<span class="stat">Daily: <b>$' + d.auto.dailySpent.toFixed(2) + '/$10</b></span>' +
      '<span class="stat">Invested: <b>$' + d.auto.invested.toFixed(2) + '</b></span>' +
      '<span class="stat">Returned: <b>$' + d.auto.returned.toFixed(2) + '</b></span>';

    // Signal Bot
    if (d.signal.data) {
      const s = d.signal.data;
      const sigColor = s.signal === 'BUY UP' ? 'green' : s.signal === 'BUY DOWN' ? 'red' : 'gray';
      document.getElementById('signalData').innerHTML =
        '<div class="signal-grid">' +
        '<div class="signal-item"><div class="label">Signal</div><div class="value ' + sigColor + '">' + (s.signal || '-') + '</div></div>' +
        '<div class="signal-item"><div class="label">Regime</div><div class="value">' + (s.regime || '-') + '</div></div>' +
        '<div class="signal-item"><div class="label">Time Left</div><div class="value">' + (s.time_left_min ? Number(s.time_left_min).toFixed(1) + 'm' : '-') + '</div></div>' +
        '<div class="signal-item"><div class="label">Model UP</div><div class="value green">' + (s.model_up ? pct(Number(s.model_up)) : '-') + '</div></div>' +
        '<div class="signal-item"><div class="label">Model DOWN</div><div class="value red">' + (s.model_down ? pct(Number(s.model_down)) : '-') + '</div></div>' +
        '<div class="signal-item"><div class="label">Recommendation</div><div class="value">' + (s.recommendation || '-') + '</div></div>' +
        '</div>';
    } else {
      document.getElementById('signalData').innerHTML = '<div class="empty">No signal data yet — waiting for first candle</div>';
    }

    // Activity
    if (d.activity.length === 0) {
      document.getElementById('activity').innerHTML = '<div class="empty">No activity yet — bots starting up</div>';
    } else {
      document.getElementById('activity').innerHTML = d.activity.map(a =>
        '<div class="activity-line ' + a.bot + '"><span class="bot-tag">[' + a.bot.toUpperCase().slice(0,3) + ']</span>' + a.line.slice(0, 120) + '</div>'
      ).join('');
    }
    // Update status bar
    var ub = document.getElementById('updateBar');
    if (d.updateStatus === 'updating') {
      ub.innerHTML = '<span class="busy">Updating... restarting shortly</span>';
    } else if (d.updateStatus === 'up-to-date' && d.lastUpdateCheck) {
      ub.innerHTML = '<span class="up">Auto-update active</span> · Last check: ' + d.lastUpdateCheck + ' ET';
    } else if (d.updateStatus && d.updateStatus.includes('error')) {
      ub.innerHTML = '<span class="err">Update check failed</span> — will retry in 60s';
    } else {
      ub.innerHTML = 'Auto-update: starting...';
    }
  } catch(e) {
    console.error('Refresh failed:', e);
  }
}

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;

// ── Server ──
const server = http.createServer(async (req, res) => {
  if (req.url === "/api/status") {
    try {
      const data = await getStatus();
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
  }
});

let listenRetries = 0;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && listenRetries < 5) {
    listenRetries++;
    console.log(`  Port ${PORT} in use — killing old process and retrying in 3s... (attempt ${listenRetries}/5)`);
    // Try to kill whatever is holding the port
    const killCmd = process.platform === "win32"
      ? `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /PID %a`
      : `fuser -k ${PORT}/tcp`;
    exec(killCmd, () => {
      setTimeout(() => server.listen(PORT), 3000);
    });
  } else {
    console.error(`  Fatal server error: ${err.message}`);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Dashboard running at: http://localhost:${PORT}`);

  // Spawn all bots as child processes
  console.log("  Starting bots...");
  spawnBots();

  // Start auto-update polling (every 60 seconds)
  console.log("  Auto-update enabled (checks every 60s)\n");
  checkForUpdates();
  setInterval(checkForUpdates, 60000);

  // Auto-open browser
  const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${cmd} http://localhost:${PORT}`);
});

// Clean shutdown — kill bot children on exit
function shutdown() { killBots(); process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => { for (const { proc } of botProcs) try { proc.kill(); } catch {} });
