import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DemoLayout, { metadata } from "@/app/demo/layout";

// AC-PD7 (docs/prd/public-demo.md): a visible, non-intrusive synthetic-data
// marker on the demo surface, plus NFR-54's allow-index posture stated
// explicitly (not left to an inherited default).

describe("demo layout (AC-PD7, NFR-54)", () => {
  it("AC-PD7: renders the synthetic-data banner around its children", () => {
    const markup = renderToStaticMarkup(
      <DemoLayout>
        <div data-testid="child" />
      </DemoLayout>,
    );
    expect(markup).toContain("Demo — synthetic data, not real biometrics");
    expect(markup).toContain('data-testid="child"');
  });

  it("NFR-54: crawl posture is explicitly allow-index, not an inherited default", () => {
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("AC-PD7: title and description name this a synthetic-data demo, for the search snippet", () => {
    expect(metadata.title).toMatch(/synthetic data/i);
    expect(metadata.description).toMatch(/synthetic data/i);
  });
});
