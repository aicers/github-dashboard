import { describe, expect, it } from "vitest";
import {
  evaluateAttentionPersonRule,
  evaluateAttentionPersonRules,
  type PersonRoleContext,
} from "@/lib/activity/person-role";
import type { ActivityAttentionFilter } from "@/lib/activity/types";

const BASE_CONTEXT: PersonRoleContext = {
  isMaintainer: false,
  isAssignee: false,
  isAuthor: false,
  isReviewer: false,
  isMentioned: false,
  isCommenter: false,
  isReactor: false,
  hasAssignee: false,
  hasMaintainer: false,
};

function context(overrides: Partial<PersonRoleContext>): PersonRoleContext {
  return { ...BASE_CONTEXT, ...overrides };
}

describe("evaluateAttentionPersonRule", () => {
  it("requires maintainer for issue_backlog attention", () => {
    const success = evaluateAttentionPersonRule(
      "issue_backlog",
      context({
        isMaintainer: true,
        hasMaintainer: true,
      }),
    );
    expect(success.match).toBe(true);
    expect(success.appliedRoles).toEqual(["maintainer"]);
    expect(success.optionalRoles).toEqual([]);

    const failure = evaluateAttentionPersonRule("issue_backlog", BASE_CONTEXT);
    expect(failure.match).toBe(false);
    expect(failure.appliedRoles).toEqual([]);
    expect(failure.optionalRoles).toEqual([]);
  });

  it("prefers assignee for issue_stalled when available", () => {
    const result = evaluateAttentionPersonRule(
      "issue_stalled",
      context({
        isAssignee: true,
        hasAssignee: true,
      }),
    );
    expect(result.match).toBe(true);
    expect(result.appliedRoles).toEqual(["assignee"]);
    expect(result.optionalRoles).toEqual(["author"]);
  });

  it("falls back to maintainer when no assignee on issue_stalled", () => {
    const result = evaluateAttentionPersonRule(
      "issue_stalled",
      context({
        hasAssignee: false,
        isMaintainer: true,
        hasMaintainer: true,
      }),
    );
    expect(result.match).toBe(true);
    expect(result.appliedRoles).toEqual(["maintainer"]);
    expect(result.optionalRoles).toEqual(["author"]);
  });

  it("falls back to author when no assignee or maintainer on issue_stalled", () => {
    const result = evaluateAttentionPersonRule(
      "issue_stalled",
      context({
        hasAssignee: false,
        hasMaintainer: false,
        isAuthor: true,
      }),
    );
    expect(result.match).toBe(true);
    expect(result.appliedRoles).toEqual(["author"]);
    expect(result.optionalRoles).toEqual([]);
  });

  it("fails when no rule matches on issue_stalled", () => {
    const result = evaluateAttentionPersonRule("issue_stalled", BASE_CONTEXT);
    expect(result.match).toBe(false);
    expect(result.appliedRoles).toEqual([]);
    expect(result.optionalRoles).toEqual([]);
  });

  it("permits multiple roles for stale or idle PR attentions", () => {
    const result = evaluateAttentionPersonRule(
      "pr_open_too_long",
      context({
        isAuthor: true,
        isReviewer: true,
      }),
    );
    expect(result.match).toBe(true);
    expect(result.appliedRoles).toEqual(
      expect.arrayContaining(["author", "reviewer"]),
    );
    expect(result.optionalRoles).toEqual([]);
  });

  it("limits review request attention to reviewers", () => {
    const failure = evaluateAttentionPersonRule(
      "review_requests_pending",
      BASE_CONTEXT,
    );
    expect(failure.match).toBe(false);
    expect(failure.optionalRoles).toEqual([]);

    const success = evaluateAttentionPersonRule(
      "review_requests_pending",
      context({
        isReviewer: true,
      }),
    );
    expect(success.match).toBe(true);
    expect(success.appliedRoles).toEqual(["reviewer"]);
    expect(success.optionalRoles).toEqual([]);
  });

  it("limits unanswered mentions to mentioned role", () => {
    const failure = evaluateAttentionPersonRule(
      "unanswered_mentions",
      BASE_CONTEXT,
    );
    expect(failure.match).toBe(false);
    expect(failure.optionalRoles).toEqual([]);

    const success = evaluateAttentionPersonRule(
      "unanswered_mentions",
      context({
        isMentioned: true,
      }),
    );
    expect(success.match).toBe(true);
    expect(success.appliedRoles).toEqual(["mentioned"]);
    expect(success.optionalRoles).toEqual([]);
  });
});

describe("evaluateAttentionPersonRules", () => {
  it("evaluates multiple attentions in order", () => {
    const attentions: ActivityAttentionFilter[] = [
      "issue_backlog",
      "unanswered_mentions",
    ];

    const resolutions = evaluateAttentionPersonRules(
      attentions,
      context({
        isMaintainer: true,
        hasMaintainer: true,
        isMentioned: true,
      }),
    );

    expect(resolutions).toHaveLength(2);
    expect(resolutions.every((resolution) => resolution.match)).toBe(true);
  });
});
