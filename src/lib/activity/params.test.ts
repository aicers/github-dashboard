import { describe, expect, it } from "vitest";

import {
  createSearchParamsFromRecord,
  parseActivityListParams,
} from "@/lib/activity/params";

describe("parseActivityListParams", () => {
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
