import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { readEnv } from "./env";

// Target secrets are encrypted at rest with AES-256-GCM. The key is derived from APP_SECRET (HKDF), so the
// database alone is not enough to read them. Format: v1:<iv>.<tag>.<ciphertext> (base64url).
function key(): Buffer {
  const secret = readEnv().APP_SECRET;
  if (!secret) throw new Error("APP_SECRET must be set to at least 32 characters");
  return Buffer.from(hkdfSync("sha256", secret, "emulator-console", "target-secrets-v1", 32));
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

export function decrypt(blob: string): string {
  const [v, rest] = blob.split(":");
  if (v !== "v1" || !rest) throw new Error("unsupported ciphertext");
  const parts = rest.split(".");
  if (parts.length !== 3) throw new Error("malformed ciphertext");
  const [iv, tag, ct] = parts.map((p) => Buffer.from(p, "base64url")) as [Buffer, Buffer, Buffer];
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
