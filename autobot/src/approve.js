import { ethers } from "ethers";
import { CFG } from "./config.js";
const MAX = ethers.MaxUint256;

async function main() {
  if (!CFG.privateKey) { console.error("Set PRIVATE_KEY in .env"); process.exit(1); }
  const provider = new ethers.JsonRpcProvider(CFG.polygonRpc);
  const wallet = new ethers.Wallet(CFG.privateKey, provider);
  console.log(`Wallet: ${wallet.address}`);

  const usdc = new ethers.Contract(CFG.usdc,
    ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"], wallet);
  const ctf = new ethers.Contract(CFG.ctf,
    ["function setApprovalForAll(address,bool)", "function isApprovedForAll(address,address) view returns (bool)"], wallet);

  for (const [label, addr] of [["Exchange", CFG.exchange], ["NegRisk Exchange", CFG.negRiskExchange], ["NegRisk Adapter", CFG.negRiskAdapter]]) {
    const allow = await usdc.allowance(wallet.address, addr);
    if (allow < ethers.parseUnits("1000000", 6)) {
      console.log(`Approving USDC for ${label}…`);
      await (await usdc.approve(addr, MAX)).wait();
    } else { console.log(`USDC OK for ${label}`); }
    if (!(await ctf.isApprovedForAll(wallet.address, addr))) {
      console.log(`Approving CTF for ${label}…`);
      await (await ctf.setApprovalForAll(addr, true)).wait();
    } else { console.log(`CTF OK for ${label}`); }
  }
  console.log("\nAll approvals set.");
}
main().catch(e => { console.error(e); process.exit(1); });
