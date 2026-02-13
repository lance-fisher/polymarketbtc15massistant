import { randomBytes, createHmac } from "node:crypto";
import { CFG } from "./config.js";

const BUY = 0, SELL = 1;

/* ─── L1 Auth: EIP-712 ClobAuth → derive API key ──────────── */

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
    address: wallet.address,
    timestamp: ts,
    nonce: 0n,
    message: "This message attests that I control the given wallet",
  });

  // Try create first (POST), fall back to derive (GET)
  let res = await fetch(`${CFG.clobUrl}/auth/api-key`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "POLY-ADDRESS":   wallet.address,
      "POLY-SIGNATURE": sig,
      "POLY-TIMESTAMP": ts,
      "POLY-NONCE":     "0",
    },
  });
  if (!res.ok) {
    res = await fetch(`${CFG.clobUrl}/auth/derive-api-key`, {
      method: "GET",
      headers: {
        "POLY-ADDRESS":   wallet.address,
        "POLY-SIGNATURE": sig,
        "POLY-TIMESTAMP": ts,
        "POLY-NONCE":     "0",
      },
    });
  }
  if (!res.ok) throw new Error(`derive-api-key ${res.status}: ${await res.text()}`);
  return res.json();                    // { apiKey, secret, passphrase }
}

/* ─── L2 Auth: HMAC-SHA256 for authenticated requests ──────── */

function hmacSign(secret, message) {
  return createHmac("sha256", Buffer.from(secret, "base64"))
    .update(message)
    .digest("base64");
}

export function l2Headers(creds, wallet, method, path, body = "") {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = hmacSign(creds.secret, ts + method + path + body);
  return {
    "POLY-ADDRESS":    wallet.address,
    "POLY-SIGNATURE":  sig,
    "POLY-TIMESTAMP":  ts,
    "POLY-NONCE":      String(Date.now()),
    "POLY-API-KEY":    creds.apiKey,
    "POLY-PASSPHRASE": creds.passphrase,
    "Content-Type":    "application/json",
  };
}

/* ─── EIP-712 Order Signing ────────────────────────────────── */

const ORDER_TYPES = {
  Order: [
    { name: "salt",          type: "uint256" },
    { name: "maker",         type: "address" },
    { name: "signer",        type: "address" },
    { name: "taker",         type: "address" },
    { name: "tokenId",       type: "uint256" },
    { name: "makerAmount",   type: "uint256" },
    { name: "takerAmount",   type: "uint256" },
    { name: "expiration",    type: "uint256" },
    { name: "nonce",         type: "uint256" },
    { name: "feeRateBps",    type: "uint256" },
    { name: "side",          type: "uint8"   },
    { name: "signatureType", type: "uint8"   },
  ],
};

function orderDomain(negRisk) {
  return {
    name: "Polymarket CTF Exchange",
    version: "1",
    chainId: CFG.chainId,
    verifyingContract: negRisk ? CFG.negRiskExchange : CFG.exchange,
  };
}

function roundDown(v, dec = 6) {
  const f = 10 ** dec;
  return Math.floor(v * f) / f;
}

/**
 * Build, sign, and post an order to the CLOB.
 * @param {object} p
 * @param {import("ethers").Wallet} p.wallet
 * @param {object} p.creds   - { apiKey, secret, passphrase }
 * @param {"BUY"|"SELL"} p.side
 * @param {string} p.tokenId - outcome token ID
 * @param {number} p.price   - 0.01–0.99
 * @param {number} p.amount  - USDC for BUY, tokens for SELL
 * @param {boolean} p.negRisk
 * @param {string}  [p.orderType="FOK"]
 */
export async function placeOrder({ wallet, creds, side, tokenId, price, amount, negRisk, orderType = "FOK" }) {
  const isBuy = side === "BUY";
  const sideInt = isBuy ? BUY : SELL;
  const salt = BigInt("0x" + randomBytes(32).toString("hex"));

  let makerAmt, takerAmt;
  if (isBuy) {
    makerAmt = BigInt(Math.round(roundDown(amount, 6) * 1e6));
    takerAmt = BigInt(Math.round(roundDown(amount / price, 6) * 1e6));
  } else {
    makerAmt = BigInt(Math.round(roundDown(amount, 6) * 1e6));
    takerAmt = BigInt(Math.round(roundDown(amount * price, 6) * 1e6));
  }

  const order = {
    salt,
    maker:         wallet.address,
    signer:        wallet.address,
    taker:         "0x0000000000000000000000000000000000000000",
    tokenId:       BigInt(tokenId),
    makerAmount:   makerAmt,
    takerAmount:   takerAmt,
    expiration:    0n,
    nonce:         0n,
    feeRateBps:    200n,    // 2 %
    side:          sideInt,
    signatureType: 0,       // EOA
  };

  const signature = await wallet.signTypedData(orderDomain(negRisk), ORDER_TYPES, order);

  const body = JSON.stringify({
    order: {
      salt:          order.salt.toString(),
      maker:         order.maker,
      signer:        order.signer,
      taker:         order.taker,
      tokenId:       order.tokenId.toString(),
      makerAmount:   order.makerAmount.toString(),
      takerAmount:   order.takerAmount.toString(),
      expiration:    "0",
      nonce:         "0",
      feeRateBps:    "200",
      side:          sideInt,
      signatureType: 0,
      signature,
    },
    owner:     wallet.address,
    orderType,
  });

  const path = "/order";
  const hdrs = l2Headers(creds, wallet, "POST", path, body);
  const res  = await fetch(CFG.clobUrl + path, { method: "POST", headers: hdrs, body });
  const json = await res.json().catch(() => ({ success: false, errorMsg: `HTTP ${res.status}` }));
  return json;
}

/* ─── Price helpers ────────────────────────────────────────── */

export async function getBookPrice(tokenId, side = "BUY") {
  const res = await fetch(`${CFG.clobUrl}/book?token_id=${tokenId}`);
  if (!res.ok) return null;
  const book = await res.json();
  if (side === "BUY") {
    const asks = book.asks || [];
    if (!asks.length) return null;
    return Math.min(...asks.map((a) => Number(a.price)));
  }
  const bids = book.bids || [];
  if (!bids.length) return null;
  return Math.max(...bids.map((b) => Number(b.price)));
}
