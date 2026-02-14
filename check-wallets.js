#!/usr/bin/env node
/**
 * Quick wallet balance checker — runs before bots start.
 * Checks USDC + MATIC for all 3 bot wallets on Polygon.
 * Prints funding instructions if any wallet needs funding.
 */
import { ethers } from "ethers";

const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const WALLETS = [
  { name: "Signal Bot", address: "0x5eD48e29dcd952955d7E4fccC3616EFA38cD75a5" },
  { name: "Copy Bot",   address: "0xf35803f093BBceaBEb9A6abd3d4c99856BDdA40C" },
  { name: "Auto Bot",   address: "0xf17Cb352380Fd5503742c5A0573cDE4c656d8486" },
];

const RPC = process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com";

async function main() {
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(RPC, 137, { staticNetwork: true });
    // Quick connectivity test
    await provider.getBlockNumber();
  } catch {
    console.log("  [wallet] Could not reach Polygon RPC — will check balances later");
    process.exit(0);
  }

  const usdc = new ethers.Contract(USDC, ["function balanceOf(address) view returns (uint256)"], provider);

  let needsFunding = false;
  const results = [];

  for (const w of WALLETS) {
    try {
      const [usdcBal, maticBal] = await Promise.all([
        usdc.balanceOf(w.address).then(b => Number(b) / 1e6),
        provider.getBalance(w.address).then(b => Number(ethers.formatEther(b))),
      ]);

      const usdcOk = usdcBal >= 5;
      const maticOk = maticBal >= 0.01;
      const status = usdcOk && maticOk ? "READY" : "NEEDS FUNDING";
      if (!usdcOk || !maticOk) needsFunding = true;

      results.push({ ...w, usdcBal, maticBal, usdcOk, maticOk, status });
      console.log(`  ${w.name.padEnd(12)} $${usdcBal.toFixed(2)} USDC | ${maticBal.toFixed(4)} MATIC  [${status}]`);
    } catch (e) {
      console.log(`  ${w.name.padEnd(12)} Could not check: ${e.message.slice(0, 50)}`);
    }
  }

  if (needsFunding) {
    console.log();
    console.log("  ╔════════════════════════════════════════════════════════╗");
    console.log("  ║  WALLETS NEED FUNDING — bots will start but can't     ║");
    console.log("  ║  trade until you send funds to these addresses:        ║");
    console.log("  ╚════════════════════════════════════════════════════════╝");
    console.log();

    for (const r of results) {
      if (r.status === "NEEDS FUNDING") {
        const needs = [];
        if (!r.usdcOk) needs.push(`$${Math.max(0, 20 - r.usdcBal).toFixed(0)} USDC`);
        if (!r.maticOk) needs.push(`0.5 MATIC (gas)`);
        console.log(`  ${r.name}: ${r.address}`);
        console.log(`    Send: ${needs.join(" + ")} on Polygon network`);
        console.log();
      }
    }

    console.log("  How to fund (easiest methods):");
    console.log("  1. Coinbase/Binance → withdraw USDC + MATIC to Polygon");
    console.log("  2. Send from another Polygon wallet (MetaMask, etc.)");
    console.log("  3. Bridge from Ethereum via https://wallet.polygon.technology");
    console.log();
    console.log("  Recommended: $20 USDC + 0.5 MATIC per wallet");
    console.log("  Minimum:     $5 USDC + 0.1 MATIC per wallet");
    console.log();
  } else {
    console.log();
    console.log("  All wallets funded and ready to trade!");
  }
}

main().catch(() => process.exit(0));
