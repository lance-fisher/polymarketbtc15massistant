import { ethers } from "ethers";
import { CFG } from "./config.js";
const MAX = ethers.MaxUint256;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function retry(fn, retries = 3, delayMs = 5000) {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      console.log(`  Retry ${i + 1}/${retries} in ${delayMs / 1000}s — ${e.message.slice(0, 80)}`);
      await sleep(delayMs * (i + 1));
    }
  }
}

async function main() {
  if (!CFG.privateKey) { console.error("Set PRIVATE_KEY in .env"); process.exit(1); }
  const provider = new ethers.JsonRpcProvider(CFG.polygonRpc, 137, { staticNetwork: true });
  const wallet = new ethers.Wallet(CFG.privateKey, provider);
  console.log(`Wallet: ${wallet.address}`);

  const usdc = new ethers.Contract(CFG.usdc,
    ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"], wallet);
  const ctf = new ethers.Contract(CFG.ctf,
    ["function setApprovalForAll(address,bool)", "function isApprovedForAll(address,address) view returns (bool)"], wallet);

  const gasOverrides = { maxFeePerGas: ethers.parseUnits("50", "gwei"), maxPriorityFeePerGas: ethers.parseUnits("30", "gwei") };

  for (const [label, addr] of [["Exchange", CFG.exchange], ["NegRisk Exchange", CFG.negRiskExchange], ["NegRisk Adapter", CFG.negRiskAdapter]]) {
    const allow = await retry(() => usdc.allowance(wallet.address, addr));
    if (allow < ethers.parseUnits("1000000", 6)) {
      console.log(`Approving USDC for ${label}…`);
      const tx = await retry(() => usdc.approve(addr, MAX, gasOverrides));
      await tx.wait();
      console.log(`  tx ${tx.hash}`);
    } else { console.log(`USDC OK for ${label}`); }

    if (!(await retry(() => ctf.isApprovedForAll(wallet.address, addr)))) {
      console.log(`Approving CTF for ${label}…`);
      const tx = await retry(() => ctf.setApprovalForAll(addr, true, gasOverrides));
      await tx.wait();
      console.log(`  tx ${tx.hash}`);
    } else { console.log(`CTF OK for ${label}`); }

    await sleep(2000);
  }
  console.log("\nAll approvals set.");
}
main().catch(e => { console.error(e); process.exit(1); });
