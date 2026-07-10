import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authorized, signIn } from "@/lib/auth-callbacks";

// These two callbacks are the automatable core of the login gate. The full
// magic-link click-through (email delivery + a human clicking) stays manually
// verified — these tests are the proxy for its access-control logic.

describe("signIn callback — allowlist", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("ALLOWLISTED_EMAIL", "albert.martinez.90@gmail.com");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("allows the exact allowlisted email", () => {
    expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(true);
  });

  it("allows the allowlisted email regardless of case", () => {
    expect(signIn({ user: { email: "Albert.Martinez.90@Gmail.com" } })).toBe(true);
  });

  it("allows the allowlisted email with surrounding whitespace", () => {
    expect(signIn({ user: { email: "  albert.martinez.90@gmail.com " } })).toBe(true);
  });

  it("normalizes case/whitespace on the allowlist side too", () => {
    vi.stubEnv("ALLOWLISTED_EMAIL", " Albert.Martinez.90@GMAIL.com ");
    expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(true);
  });

  it.each([
    "evil@example.com",
    "albert.martinez.90@gmail.com.attacker.com",
    "albert.martinez.91@gmail.com",
    "",
  ])("rejects any other address (%j)", (email) => {
    expect(signIn({ user: { email } })).toBe(false);
  });

  it("rejects a user with no email at all", () => {
    expect(signIn({ user: {} })).toBe(false);
    expect(signIn({ user: { email: null } })).toBe(false);
  });

  it("fails closed when ALLOWLISTED_EMAIL is unset: denies even a would-be match and logs", () => {
    vi.stubEnv("ALLOWLISTED_EMAIL", "");
    expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("sign-in rejected: ALLOWLISTED_EMAIL is not set");
  });

  it("fails closed when ALLOWLISTED_EMAIL is only whitespace", () => {
    vi.stubEnv("ALLOWLISTED_EMAIL", "   ");
    expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("authorized callback — session gate", () => {
  it("returns false with no session", () => {
    expect(authorized({ auth: null })).toBe(false);
  });

  it("returns true with a session", () => {
    expect(authorized({ auth: { user: { email: "albert.martinez.90@gmail.com" } } })).toBe(true);
  });
});
