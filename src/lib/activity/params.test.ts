import { describe, expect, it } from "vitest";

import {
  createSearchParamsFromRecord,
  parseActivityListParams,
} from "@/lib/activity/params";

describe("parseActivityListParams", () => {
  it("clamps perPage to the maximum and ignores non-positive page values", () => {
    const params = new URLSearchParams();
    params.set("page", "0");
    params.set("perPage", "250");

    const result = parseActivityListParams(params);

    expect(result.page).toBeUndefined();
    expect(result.perPage).toBe(100);
  });

  it("deduplicates and trims multi-value filters", () => {
    const params = new URLSearchParams();
    params.append("repositoryId", " repo-1 ");
    params.append("repositoryId", "repo-1");
    params.append("repositoryId", "");
    params.append("labelKey", "team/core ");
    params.append("labelKey", "team/core");

    const result = parseActivityListParams(params);

    expect(result.repositoryIds).toEqual(["repo-1"]);
    expect(result.labelKeys).toEqual(["team/core"]);
  });

  it("parses thresholds while enforcing minimum values", () => {
    const params = new URLSearchParams();
    params.set("backlogIssueDays", "30");
    params.set("stalePrDays", "0");
    params.set("idlePrDays", "-5");

    const result = parseActivityListParams(params);

    expect(result.thresholds).toEqual({
      backlogIssueDays: 30,
    });
  });

  it("parses issue type, milestone, and linked issue filters", () => {
    const params = new URLSearchParams();
    params.append("issueTypeId", "type-1");
    params.append("issueTypeId", "type-1");
    params.append("milestoneId", "milestone-1");
    params.append("linkedIssue", "has_parent");
    params.append("linkedIssue", "has_sub");
    params.append("prStatus", "pr_open");
    params.append("prStatus", "pr_closed");
    params.append("issueBaseStatus", "issue_open");

    const result = parseActivityListParams(params);

    expect(result.issueTypeIds).toEqual(["type-1"]);
    expect(result.milestoneIds).toEqual(["milestone-1"]);
    expect(result.linkedIssueStates).toEqual(["has_parent", "has_sub"]);
    expect(result.pullRequestStatuses).toEqual(["pr_open", "pr_closed"]);
    expect(result.issueBaseStatuses).toEqual(["issue_open"]);
  });

  it("ignores unknown linked issue values", () => {
    const params = new URLSearchParams();
    params.append("linkedIssue", "has_parent");
    params.append("linkedIssue", "invalid");

    const result = parseActivityListParams(params);

    expect(result.linkedIssueStates).toEqual(["has_parent"]);
  });

  it("supports createSearchParamsFromRecord round trip with new filters", () => {
    const search = createSearchParamsFromRecord({
      issueTypeId: ["type-1", "type-2"],
      milestoneId: ["milestone-1"],
      linkedIssue: ["has_parent"],
      prStatus: ["pr_open", "pr_merged"],
      issueBaseStatus: ["issue_closed"],
    });

    const result = parseActivityListParams(search);

    expect(result.issueTypeIds).toEqual(["type-1", "type-2"]);
    expect(result.milestoneIds).toEqual(["milestone-1"]);
    expect(result.linkedIssueStates).toEqual(["has_parent"]);
    expect(result.pullRequestStatuses).toEqual(["pr_open", "pr_merged"]);
    expect(result.issueBaseStatuses).toEqual(["issue_closed"]);
  });
});

describe("createSearchParamsFromRecord", () => {
  it("trims values and removes empty entries", () => {
    const params = createSearchParamsFromRecord({
      search: "  hello world  ",
      empty: "   ",
      repo: [" alpha ", "", "beta"],
    });

    expect(params.get("search")).toBe("hello world");
    expect(params.has("empty")).toBe(false);
    expect(params.getAll("repo")).toEqual(["alpha", "beta"]);
  });

  it("deduplicates repeated values while preserving original order", () => {
    const params = createSearchParamsFromRecord({
      repo: ["a", "a", "b", "a", "c", "b"],
      single: "value",
    });

    expect(params.getAll("repo")).toEqual(["a", "b", "c"]);
    expect(params.get("single")).toBe("value");
  });
});
