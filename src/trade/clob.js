import { randomBytes, createHmac } from "node:crypto";

const BUY = 0, SELL = 1;

/* ─── L1 Auth: derive CLOB API key via EIP-712 ────────────── */

const AUTH_DOMAIN = { name: "ClobAuthDomain", version: "1", chainId: 137 };
const AUTH_TYPES = {
  ClobAuth: [
    { name: "address",   type: "address" },
    { name: "timestamp", type: "string"  },
    { name: "nonce",     type: "uint256" },
    { name: "message",   type: "string"  },
  ],
};

export async function deriveApiKey(wallet, clobUrl) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await wallet.signTypedData(AUTH_DOMAIN, AUTH_TYPES, {
    address: wallet.address,
    timestamp: ts,
    nonce: 0n,
    message: "This message attests that I control the given wallet",
  });

  const res = await fetch(`${clobUrl}/auth/derive-api-key`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "POLY-ADDRESS":   wallet.address,
      "POLY-SIGNATURE": sig,
      "POLY-TIMESTAMP": ts,
      "POLY-NONCE":     "0",
    },
  });
  if (!res.ok) throw new Error(`derive-api-key ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ─── L2 Auth: HMAC headers for authenticated requests ─────── */

function hmacSign(secret, message) {
  return createHmac("sha256", Buffer.from(secret, "base64"))
    .update(message)
    .digest("base64");
}

function l2Headers(creds, wallet, method, path, body = "") {
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

const EXCHANGE         = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";

function orderDomain(negRisk) {
  return {
    name: "Polymarket CTF Exchange",
    version: "1",
    chainId: 137,
    verifyingContract: negRisk ? NEG_RISK_EXCHANGE : EXCHANGE,
  };
}

function roundDown(v, dec = 6) {
  const f = 10 ** dec;
  return Math.floor(v * f) / f;
}

/**
 * Build, sign, and post a BUY order to the CLOB.
 */
export async function placeBuyOrder({ wallet, creds, clobUrl, tokenId, price, usdcAmount, negRisk = false }) {
  const salt = BigInt("0x" + randomBytes(32).toString("hex"));
  const makerAmt = BigInt(Math.round(roundDown(usdcAmount, 6) * 1e6));
  const takerAmt = BigInt(Math.round(roundDown(usdcAmount / price, 6) * 1e6));

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
    feeRateBps:    200n,
    side:          BUY,
    signatureType: 0,
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
      side:          BUY,
      signatureType: 0,
      signature,
    },
    owner:     wallet.address,
    orderType: "FOK",
  });

  const path = "/order";
  const hdrs = l2Headers(creds, wallet, "POST", path, body);
  const res  = await fetch(clobUrl + path, { method: "POST", headers: hdrs, body });
  return res.json().catch(() => ({ success: false, errorMsg: `HTTP ${res.status}` }));
}
