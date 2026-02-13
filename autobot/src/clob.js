import { randomBytes, createHmac } from "node:crypto";
import { CFG } from "./config.js";

const BUY = 0;

const AUTH_DOMAIN = { name: "ClobAuthDomain", version: "1", chainId: CFG.chainId };
const AUTH_TYPES = {
  ClobAuth: [
    { name: "address",   type: "address" },
    { name: "timestamp", type: "string"  },
    { name: "nonce",     type: "uint256" },
    { name: "message",   type: "string"  },
  ],
};

export async function deriveApiKey(wallet) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await wallet.signTypedData(AUTH_DOMAIN, AUTH_TYPES, {
    address: wallet.address, timestamp: ts, nonce: 0n,
    message: "This message attests that I control the given wallet",
  });
  const res = await fetch(`${CFG.clobUrl}/auth/derive-api-key`, {
    method: "POST",
    headers: { "Content-Type":"application/json", "POLY-ADDRESS":wallet.address, "POLY-SIGNATURE":sig, "POLY-TIMESTAMP":ts, "POLY-NONCE":"0" },
  });
  if (!res.ok) throw new Error(`derive-api-key ${res.status}: ${await res.text()}`);
  return res.json();
}

function l2Headers(creds, wallet, method, path, body = "") {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(creds.secret, "base64")).update(ts + method + path + body).digest("base64");
  return { "POLY-ADDRESS":wallet.address, "POLY-SIGNATURE":sig, "POLY-TIMESTAMP":ts, "POLY-NONCE":String(Date.now()), "POLY-API-KEY":creds.apiKey, "POLY-PASSPHRASE":creds.passphrase, "Content-Type":"application/json" };
}

const ORDER_TYPES = {
  Order: [
    { name: "salt", type: "uint256" }, { name: "maker", type: "address" },
    { name: "signer", type: "address" }, { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" }, { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" }, { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" }, { name: "signatureType", type: "uint8" },
  ],
};

function orderDomain(negRisk) {
  return { name: "Polymarket CTF Exchange", version: "1", chainId: CFG.chainId,
    verifyingContract: negRisk ? CFG.negRiskExchange : CFG.exchange };
}

function rd(v, d = 6) { const f = 10 ** d; return Math.floor(v * f) / f; }

export async function placeBuyOrder({ wallet, creds, tokenId, price, usdcAmount, negRisk = false }) {
  const salt = BigInt("0x" + randomBytes(32).toString("hex"));
  const order = {
    salt, maker: wallet.address, signer: wallet.address,
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: BigInt(tokenId),
    makerAmount: BigInt(Math.round(rd(usdcAmount, 6) * 1e6)),
    takerAmount: BigInt(Math.round(rd(usdcAmount / price, 6) * 1e6)),
    expiration: 0n, nonce: 0n, feeRateBps: 200n, side: BUY, signatureType: 0,
  };
  const signature = await wallet.signTypedData(orderDomain(negRisk), ORDER_TYPES, order);
  const body = JSON.stringify({
    order: { salt: order.salt.toString(), maker: order.maker, signer: order.signer,
      taker: order.taker, tokenId: order.tokenId.toString(),
      makerAmount: order.makerAmount.toString(), takerAmount: order.takerAmount.toString(),
      expiration: "0", nonce: "0", feeRateBps: "200", side: BUY, signatureType: 0, signature },
    owner: wallet.address, orderType: "FOK",
  });
  const path = "/order";
  const res = await fetch(CFG.clobUrl + path, { method: "POST", headers: l2Headers(creds, wallet, "POST", path, body), body });
  return res.json().catch(() => ({ success: false, errorMsg: `HTTP ${res.status}` }));
}
