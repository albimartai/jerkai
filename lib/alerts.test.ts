import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendSyncFailureAlert } from "@/lib/alerts";

// The contract under test: sendSyncFailureAlert never throws — every failure
// mode degrades to a console.error so alerting can't take down the ingest
// path that calls it.

const fetchMock = vi.fn();
let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  vi.stubEnv("SYNC_ALERT_EMAIL_TO", "albert@example.com");
  vi.stubGlobal("fetch", fetchMock);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe("sendSyncFailureAlert — success path", () => {
  it("POSTs to Resend with the key, recipient, subject and body, and logs the email id", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "email_abc123" }), { status: 200 }),
    );

    await sendSyncFailureAlert("subject line", "body text");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(init.body)).toMatchObject({
      to: ["albert@example.com"],
      subject: "subject line",
      text: "body text",
    });
    expect(logSpy).toHaveBeenCalledWith("sync alert sent: email_abc123");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("sendSyncFailureAlert — degraded responses (must not throw)", () => {
  it("handles a 200 whose body is not valid JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>not json</html>", { status: 200 }));

    await expect(sendSyncFailureAlert("s", "b")).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith("sync alert sent: (no id in Resend response)");
  });

  it("handles a 200 JSON body with no id field", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(sendSyncFailureAlert("s", "b")).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith("sync alert sent: (no id in Resend response)");
  });

  it("handles a 200 JSON body whose id is not a string", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 42 }), { status: 200 }));

    await expect(sendSyncFailureAlert("s", "b")).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith("sync alert sent: (no id in Resend response)");
  });

  it("logs an error (and does not throw) on a non-2xx from Resend", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "API key is invalid" }), { status: 401 }),
    );

    await expect(sendSyncFailureAlert("s", "b")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("sync alert email failed: 401"),
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logs an error (and does not throw) when fetch itself rejects", async () => {
    const netError = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(netError);

    await expect(sendSyncFailureAlert("s", "b")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("sync alert email failed:", netError);
  });
});

describe("sendSyncFailureAlert — missing configuration", () => {
  it.each([
    ["AUTH_RESEND_KEY", "SYNC_ALERT_EMAIL_TO"],
    ["SYNC_ALERT_EMAIL_TO", "AUTH_RESEND_KEY"],
  ])("skips the send and logs an error when %s is unset", async (missing) => {
    vi.stubEnv(missing, "");

    await expect(sendSyncFailureAlert("s", "b")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "sync alert not sent: AUTH_RESEND_KEY and/or SYNC_ALERT_EMAIL_TO is not set",
    );
  });
});
