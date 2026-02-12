/**
 * One-time: approve USDC and CTF spending for both exchanges.
 * Run with:  npm run approve
 */
import { ethers } from "ethers";
import { CFG } from "./config.js";

const MAX = ethers.MaxUint256;

async function main() {
  if (!CFG.privateKey) { console.error("Set PRIVATE_KEY in .env"); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(CFG.polygonRpc);
  const wallet = new ethers.Wallet(CFG.privateKey, provider);
  console.log(`Wallet: ${wallet.address}`);

  const usdc = new ethers.Contract(CFG.usdc,
    ["function approve(address,uint256) returns (bool)",
     "function allowance(address,address) view returns (uint256)"],
    wallet);

  const ctf = new ethers.Contract(CFG.ctf,
    ["function setApprovalForAll(address,bool)",
     "function isApprovedForAll(address,address) view returns (bool)"],
    wallet);

  const targets = [
    { label: "CTF Exchange",          addr: CFG.exchange },
    { label: "Neg-Risk CTF Exchange", addr: CFG.negRiskExchange },
    { label: "Neg-Risk Adapter",      addr: CFG.negRiskAdapter },
  ];

  for (const t of targets) {
    // USDC approval
    const allow = await usdc.allowance(wallet.address, t.addr);
    if (allow < ethers.parseUnits("1000000", 6)) {
      console.log(`Approving USDC for ${t.label}…`);
      const tx = await usdc.approve(t.addr, MAX);
      await tx.wait();
      console.log(`  ✓ tx ${tx.hash}`);
    } else {
      console.log(`USDC already approved for ${t.label}`);
    }

    // CTF (ERC-1155) approval
    const ok = await ctf.isApprovedForAll(wallet.address, t.addr);
    if (!ok) {
      console.log(`Approving CTF for ${t.label}…`);
      const tx = await ctf.setApprovalForAll(t.addr, true);
      await tx.wait();
      console.log(`  ✓ tx ${tx.hash}`);
    } else {
      console.log(`CTF already approved for ${t.label}`);
    }
  }

  console.log("\nAll approvals set. You can now run: npm start");
}

main().catch((e) => { console.error(e); process.exit(1); });
