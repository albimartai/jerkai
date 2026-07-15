import { afterEach, describe, expect, it, vi } from "vitest";

import { decryptToken, encryptToken } from "@/lib/whoop-crypto";

const KEY = "a".repeat(64); // any 32-byte hex string

afterEach(() => {
  vi.unstubAllEnvs();
});

function withKey(hex: string | undefined) {
  if (hex === undefined) {
    vi.stubEnv("WHOOP_TOKEN_ENCRYPTION_KEY", "");
  } else {
    vi.stubEnv("WHOOP_TOKEN_ENCRYPTION_KEY", hex);
  }
}

describe("whoop token encryption (AES-256-GCM at rest)", () => {
  it("round-trips a token and never stores it in the clear", () => {
    withKey(KEY);
    const token = "whoop-access-token-with-émoji-⚡";
    const stored = encryptToken(token);
    expect(stored).not.toContain(token);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptToken(stored)).toBe(token);
  });

  it("produces a different ciphertext per call (random IV) that still decrypts", () => {
    withKey(KEY);
    const first = encryptToken("same-token");
    const second = encryptToken("same-token");
    expect(first).not.toBe(second);
    expect(decryptToken(first)).toBe("same-token");
    expect(decryptToken(second)).toBe("same-token");
  });

  it("fails loudly on tampered ciphertext (GCM auth tag)", () => {
    withKey(KEY);
    const stored = encryptToken("token");
    const [v, iv, tag, data] = stored.split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptToken([v, iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });

  it("fails loudly when decrypting with a rotated (different) key", () => {
    withKey(KEY);
    const stored = encryptToken("token");
    withKey("b".repeat(64));
    expect(() => decryptToken(stored)).toThrow();
  });

  it("rejects an unrecognized stored format", () => {
    withKey(KEY);
    expect(() => decryptToken("not-a-token-blob")).toThrow(/unrecognized format/);
  });

  it("rejects a missing or malformed key with actionable guidance", () => {
    withKey(undefined);
    expect(() => encryptToken("token")).toThrow(/openssl rand -hex 32/);
    withKey("too-short");
    expect(() => encryptToken("token")).toThrow(/64 hex characters/);
  });
});
