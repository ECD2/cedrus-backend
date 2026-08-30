import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./CedrusV8";

describe("V8 Markdown compiler", () => {
  it("extracts a title, plan rules, time references, and durations", () => {
    const result = compileMarkdown("race-plan.md", `
# Miami Triathlon

- Run every Tuesday at 6:00 AM for 45 minutes.
- Swim twice weekly for 1 hour.
- Long ride must happen before noon on Saturday.
- Prefer strength around 5:30 PM if possible.
`);

    expect(result.title).toBe("Miami Triathlon");
    expect(result.rules).toBeGreaterThanOrEqual(4);
    expect(result.assumptions).toBeGreaterThanOrEqual(1);
    expect(result.times).toContain("6:00 AM");
    expect(result.durations).toEqual(expect.arrayContaining(["45 minutes", "1 hour"]));
    expect(result.preview[0]).toContain("Run every Tuesday");
  });
});
