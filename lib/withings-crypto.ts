import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// At-rest encryption for Withings OAuth tokens (AES-256-GCM — authenticated,
// so a tampered or wrong-key ciphertext fails loudly instead of decrypting to
// garbage). Mirrors lib/whoop-crypto.ts's shape exactly, under its own
// WITHINGS_TOKEN_ENCRYPTION_KEY (NFR-103) — a dedicated key rather than a
// shared/generalized crypto helper, so either integration's key can be
// rotated independently.
//
// Stored format: "v1.<iv b64>.<auth tag b64>.<ciphertext b64>" — versioned so
// a future algorithm change can coexist with old rows.

function encryptionKey(): Buffer {
  const hex = process.env.WITHINGS_TOKEN_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      "WITHINGS_TOKEN_ENCRYPTION_KEY must be 64 hex characters (generate: openssl rand -hex 32)",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptToken(stored: string): string {
  const [version, iv, tag, ciphertext] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("stored Withings token has an unrecognized format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
