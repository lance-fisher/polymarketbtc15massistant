import { CFG } from "./config.js";

/**
 * Send SMS via Twilio REST API (no SDK needed).
 * Returns true on success, false on failure.
 */
export async function sendSms(message) {
  const { sid, token, from } = CFG.twilio;
  const to = CFG.notifyPhone;
  if (!sid || !token || !from || !to) {
    console.log("[sms] Twilio not configured – skipping notification");
    return false;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const body = new URLSearchParams({ To: to, From: from, Body: message });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json();
    if (json.sid) {
      console.log(`[sms] Sent → ${to}`);
      return true;
    }
    console.error("[sms] Failed:", json.message || json);
    return false;
  } catch (err) {
    console.error("[sms] Error:", err.message);
    return false;
  }
}
