import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("merges class names and removes duplicates", () => {
    const classes = cn("px-2", "py-3", "px-2", {
      hidden: false,
      flex: true,
    }).split(" ");

    expect(classes).toContain("flex");
    expect(classes).not.toContain("hidden");
    expect(classes.filter((cls) => cls.startsWith("px-"))).toHaveLength(1);
  });

  it("accepts conditional values", () => {
    expect(cn("px-2", { "text-red": true, "text-blue": false })).toBe(
      "px-2 text-red",
    );
  });
});
