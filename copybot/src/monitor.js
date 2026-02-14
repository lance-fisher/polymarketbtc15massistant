import { CFG } from "./config.js";

const TIMEOUT = 20000;

/* ─── Resolve username → proxy wallet address ──────────────── */

export async function resolveAddress(username) {
  const res = await fetch(
    `${CFG.gammaUrl}/public-search?query=${encodeURIComponent(username)}`,
    { signal: AbortSignal.timeout(TIMEOUT) }
  );
  if (res.ok) {
    const data = await res.json();
    const profiles = data?.profiles ?? data ?? [];
    for (const p of Array.isArray(profiles) ? profiles : []) {
      const name = (p.pseudonym || p.displayUsernamePublic || p.name || "").toLowerCase();
      if (name === username.toLowerCase() && p.proxyWallet) return p.proxyWallet;
    }
  }

  const res2 = await fetch(
    `${CFG.dataUrl}/profile?username=${encodeURIComponent(username)}`,
    { signal: AbortSignal.timeout(TIMEOUT) }
  );
  if (res2.ok) {
    const p = await res2.json();
    if (p?.proxyWallet) return p.proxyWallet;
    if (p?.address) return p.address;
  }

  return null;
}

/* ─── Fetch positions for any address ──────────────────────── */

export async function fetchPositions(address) {
  const url = `${CFG.dataUrl}/positions?user=${address}&sortBy=CURRENT&sortDirection=DESC&sizeThreshold=0.1&limit=200`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`positions ${res.status}`);
  return res.json();
}

/* ─── Fetch market info (need negRisk flag) ────────────────── */

const marketCache = new Map();

export async function fetchMarketInfo(conditionId) {
  if (marketCache.has(conditionId)) return marketCache.get(conditionId);

  const res = await fetch(
    `${CFG.gammaUrl}/markets?condition_id=${conditionId}&limit=1`,
    { signal: AbortSignal.timeout(TIMEOUT) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const m = Array.isArray(data) ? data[0] : data;
  if (m) marketCache.set(conditionId, m);
  return m || null;
}

/* ─── Fetch our USDC balance on Polygon ────────────────────── */

export async function fetchUsdcBalance(provider, address) {
  const abi = ["function balanceOf(address) view returns (uint256)"];
  const { ethers } = await import("ethers");
  const usdc = new ethers.Contract(CFG.usdc, abi, provider);
  const bal = await usdc.balanceOf(address);
  return Number(bal) / 1e6;
}
