import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// At-rest encryption for Whoop OAuth tokens (AES-256-GCM — authenticated, so
// a tampered or wrong-key ciphertext fails loudly instead of decrypting to
// garbage). Key comes from WHOOP_TOKEN_ENCRYPTION_KEY, a dedicated secret
// rather than a reuse of HEALTH_EXPORT_SHARED_SECRET: the shared secret is a
// bearer credential sent by a third-party phone app on every request (a
// different trust domain with its own rotation story), and nothing pins it
// to the 32 bytes AES-256 requires. Rotating either secret must never force
// re-provisioning the other.
//
// Stored format: "v1.<iv b64>.<auth tag b64>.<ciphertext b64>" — versioned so
// a future algorithm change can coexist with old rows.

function encryptionKey(): Buffer {
  const hex = process.env.WHOOP_TOKEN_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      "WHOOP_TOKEN_ENCRYPTION_KEY must be 64 hex characters (generate: openssl rand -hex 32)",
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
    throw new Error("stored Whoop token has an unrecognized format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
