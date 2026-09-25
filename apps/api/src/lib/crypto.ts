import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

export { sha256 } from "./hash";

const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded");

const VERSION = 1;

/** AES-256-GCM. Layout: [version:1][iv:12][tag:16][ciphertext]. */
export function encrypt(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function decrypt(blob: Buffer): Buffer {
  if (blob[0] !== VERSION) throw new Error("Unsupported ciphertext version");
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]);
}

const b64url = (b: Buffer) => b.toString("base64url");

/** Compact HMAC-signed token for short-lived links (downloads, email tracking). */
export function signToken(payload: Record<string, string | number>, ttlSeconds: number): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = b64url(createHmac("sha256", env.JWT_SECRET).update(`link.${body}`).digest());
  return `${body}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", env.JWT_SECRET).update(`link.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
