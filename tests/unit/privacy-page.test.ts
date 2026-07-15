import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WHOOP's Developer Platform requires the privacy policy to state what is
// collected, how it's used, and how to get in touch. Assert the load-bearing
// language directly against the page source so a future edit can't silently
// weaken or drop it. (String-level on purpose — the page is static, and the
// unit suite stays free of DOM/rendering dependencies.)
// Whitespace-normalized so assertions survive JSX line reflowing.
const source = readFileSync(
  path.resolve(import.meta.dirname, "../../app/privacy/page.tsx"),
  "utf8",
).replace(/\s+/g, " ");

describe("privacy policy content", () => {
  it("names every data source", () => {
    expect(source).toContain("Fitdays");
    expect(source).toContain("Whoop");
    expect(source).toContain("Apple Health");
  });

  it("keeps the no-sale, no-sharing, no-advertising commitment", () => {
    expect(source).toContain(
      "never sold, shared with third parties, or used for advertising",
    );
  });

  it("keeps the contact email", () => {
    expect(source).toContain("albert.martinez.90@gmail.com");
  });
});
