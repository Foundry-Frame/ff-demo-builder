import { createHmac } from "node:crypto";

export type CallbackBody = {
  status: "building" | "live" | "failed" | "expired";
  url?: string;
  deploymentId?: string;
  buildLogUrl?: string;
  error?: string;
};

/** Same scheme the admin verifies: sha256 HMAC of "<unix seconds>.<body>". */
export function signCallback(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export async function sendCallback(
  callbackUrl: string,
  secret: string,
  payload: CallbackBody,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  let lastError = "";

  /* The admin may be cold-starting; retry a couple of times before giving up. */
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ff-timestamp": String(timestamp),
          "x-ff-signature": signCallback(secret, timestamp, body),
        },
        body,
      });
      if (response.ok) return;
      lastError = `${response.status} ${await response.text()}`;
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, attempt * 2000));
  }
  throw new Error(`Callback to ${callbackUrl} failed: ${lastError}`);
}
