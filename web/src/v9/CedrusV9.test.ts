import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./CedrusV9";

describe("V9 Markdown compiler", () => {
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
    expect(result.traces[0].source).toContain("Run every Tuesday");
    expect(result.fingerprint).toMatch(/^[a-f0-9]{8}$/);
  });

  it("lints plans that cannot yet reserve honest time", () => {
    const result = compileMarkdown("idea.md", "# Build something\n\n- Work on it daily if possible.");

    expect(result.issues.map((issue) => issue.title)).toEqual(expect.arrayContaining([
      "Durations are missing",
      "No preferred windows found",
      "Daily may include weekends",
    ]));
    expect(result.traces[0].ownership).toBe("inferred");
  });

  it("produces a stable fingerprint for the same immutable source", () => {
    const source = "# Plan\n- Swim every Tuesday at 7:00 AM for 45 minutes.";
    expect(compileMarkdown("plan.md", source).fingerprint).toBe(compileMarkdown("plan.md", source).fingerprint);
    expect(compileMarkdown("plan.md", `${source}\n- Add strength.`).fingerprint).not.toBe(compileMarkdown("plan.md", source).fingerprint);
  });
});
