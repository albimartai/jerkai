import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authorized, signIn } from "@/lib/auth-callbacks";
// `session` is imported dynamically inside the AC-MU7 block below (not here at module top)
// so a not-yet-existing named export fails only that describe block, not every test in this
// file — a static named import of a missing export would break the already-shipped AC-AU
// suite above as collateral damage.
import * as authCallbacksModule from "@/lib/auth-callbacks";

// These two callbacks are the automatable core of the login gate. The full
// magic-link click-through (email delivery + a human clicking) stays manually
// verified — these tests are the proxy for its access-control logic.

describe("signIn callback — allowlist", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("ALLOWLISTED_EMAILS", "albert.martinez.90@gmail.com");
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
    vi.stubEnv("ALLOWLISTED_EMAILS", " Albert.Martinez.90@GMAIL.com ");
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

  it("fails closed when ALLOWLISTED_EMAILS is unset: denies even a would-be match and logs", () => {
    vi.stubEnv("ALLOWLISTED_EMAILS", "");
    expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("sign-in rejected: ALLOWLISTED_EMAILS has no usable entries");
  });

  it("fails closed when ALLOWLISTED_EMAILS is only whitespace", () => {
    vi.stubEnv("ALLOWLISTED_EMAILS", "   ");
    expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  /**
   * AUTO-GENERATED TEST STUB — JerkAI Contract
   * PRD Target: JerkAI — Build PRD: Extend Sign-In Allowlist
   *
   * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
   * Implementation code must be written to satisfy these stubs.
   * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
   */
  describe("AC-AU: multi-email allowlist (ALLOWLISTED_EMAILS)", () => {
    it("AC-AU1: denies and logs a fixed message when ALLOWLISTED_EMAILS is unset", () => {
      vi.unstubAllEnvs();
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith("sign-in rejected: ALLOWLISTED_EMAILS has no usable entries");
    });

    it.each([
      ["", "empty string"],
      ["   ", "whitespace only"],
      [",,", "double comma, no entries"],
      [",", "trailing comma, no entries"],
    ])("AC-AU1: denies and logs when ALLOWLISTED_EMAILS is %j (%s)", (value) => {
      vi.stubEnv("ALLOWLISTED_EMAILS", value);
      expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith("sign-in rejected: ALLOWLISTED_EMAILS has no usable entries");
    });

    it("AC-AU1: denies when only the retired singular ALLOWLISTED_EMAIL is set (no longer read)", () => {
      vi.unstubAllEnvs();
      vi.stubEnv("ALLOWLISTED_EMAIL", "albert.martinez.90@gmail.com");
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith("sign-in rejected: ALLOWLISTED_EMAILS has no usable entries");
    });

    it("AC-AU2: allows the single address when ALLOWLISTED_EMAILS contains exactly one entry", () => {
      vi.stubEnv("ALLOWLISTED_EMAILS", "albert.martinez.90@gmail.com");
      expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(true);
    });

    it("AC-AU3: allows a match that is not the first entry in a multi-address list", () => {
      vi.stubEnv("ALLOWLISTED_EMAILS", "first@example.com,albert.martinez.90@gmail.com,third@example.com");
      expect(signIn({ user: { email: "albert.martinez.90@gmail.com" } })).toBe(true);
    });

    it("AC-AU4: denies an address that matches none of a multi-address list", () => {
      vi.stubEnv("ALLOWLISTED_EMAILS", "first@example.com,second@example.com");
      expect(signIn({ user: { email: "nobody@example.com" } })).toBe(false);
    });

    it("AC-AU5: matches case-insensitively and after trimming, on both the list side and the submitted side", () => {
      vi.stubEnv("ALLOWLISTED_EMAILS", " Friend@Example.COM ,other@x.com");
      expect(signIn({ user: { email: "friend@example.com" } })).toBe(true);
      expect(signIn({ user: { email: "  FRIEND@EXAMPLE.com  " } })).toBe(true);
    });

    it.each([
      ["a@x.com,,b@y.com", ""],
      ["a@x.com,", ""],
      ["a@x.com,,b@y.com", "   "],
      ["a@x.com,", "   "],
    ])(
      "AC-AU6: denies an empty/whitespace submitted address against a malformed-separator list (%j vs %j)",
      (listValue, submittedEmail) => {
        vi.stubEnv("ALLOWLISTED_EMAILS", listValue);
        expect(signIn({ user: { email: submittedEmail } })).toBe(false);
      },
    );
  });
});

describe("authorized callback — session gate", () => {
  it("returns false with no session", () => {
    expect(authorized({ auth: null })).toBe(false);
  });

  it("returns true with a session", () => {
    expect(authorized({ auth: { user: { email: "albert.martinez.90@gmail.com" } } })).toBe(true);
  });

  it("AC-AU7: is unaffected by the allowlist's representation — gates on session presence alone", () => {
    expect(authorized({ auth: null })).toBe(false);
    expect(authorized({ auth: { user: { email: "anyone@example.com" } } })).toBe(true);
  });
});

/**
 * AUTO-GENERATED TEST STUB — JerkAI Contract
 * PRD Target: JerkAI — Build PRD: Multi-User Data Model Retrofit
 *
 * DO NOT EDIT test names, AC IDs, or stub assertions during implementation.
 * Implementation code must be written to satisfy these stubs.
 * Editing stubs to fit implementation triggers a blocking finding in jerkai-falsify-diff.
 */
describe("session callback — AC-MU7: session.user.id resolves from the JWT sub claim", () => {
  it("AC-MU7: session.user.id equals the JWT token's sub claim, as a string", () => {
    const result = authCallbacksModule.session({
      session: {
        user: { name: "Albert", email: "albert.martinez.90@gmail.com", image: null },
        expires: "2099-01-01T00:00:00.000Z",
      },
      token: { sub: "42" },
    });

    expect(result.user.id).toBe("42");
  });

  it("AC-MU7: a different token.sub produces a different session.user.id (not a hardcoded value)", () => {
    const result = authCallbacksModule.session({
      session: {
        user: { name: "Friend", email: "friend@example.com", image: null },
        expires: "2099-01-01T00:00:00.000Z",
      },
      token: { sub: "7" },
    });

    expect(result.user.id).toBe("7");
  });
});
