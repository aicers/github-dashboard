import type { ActivityAttentionFilter } from "@/lib/activity/types";

export type PersonRole =
  | "maintainer"
  | "assignee"
  | "author"
  | "reviewer"
  | "mentioned"
  | "commenter"
  | "reactor";

export type PersonRoleContext = {
  isMaintainer: boolean;
  isAssignee: boolean;
  isAuthor: boolean;
  isReviewer: boolean;
  isMentioned: boolean;
  isCommenter: boolean;
  isReactor: boolean;
  hasAssignee: boolean;
  hasMaintainer: boolean;
};

export type AttentionPersonResolution = {
  attention: ActivityAttentionFilter;
  match: boolean;
  appliedRoles: PersonRole[];
  optionalRoles: PersonRole[];
};

function evaluateBacklogIssue(
  attention: ActivityAttentionFilter,
  context: PersonRoleContext,
): AttentionPersonResolution {
  if (context.isMaintainer) {
    return {
      attention,
      match: true,
      appliedRoles: ["maintainer"],
      optionalRoles: [],
    };
  }

  return {
    attention,
    match: false,
    appliedRoles: [],
    optionalRoles: [],
  };
}

function evaluateStalledIssue(
  attention: ActivityAttentionFilter,
  context: PersonRoleContext,
): AttentionPersonResolution {
  if (context.isAssignee) {
    return {
      attention,
      match: true,
      appliedRoles: ["assignee"],
      optionalRoles: ["author"],
    };
  }

  if (!context.hasAssignee && context.isMaintainer) {
    return {
      attention,
      match: true,
      appliedRoles: ["maintainer"],
      optionalRoles: ["author"],
    };
  }

  if (!context.hasAssignee && !context.hasMaintainer && context.isAuthor) {
    return {
      attention,
      match: true,
      appliedRoles: ["author"],
      optionalRoles: [],
    };
  }

  return {
    attention,
    match: false,
    appliedRoles: [],
    optionalRoles: [],
  };
}

function evaluateStaleOrIdlePr(
  attention: ActivityAttentionFilter,
  context: PersonRoleContext,
): AttentionPersonResolution {
  const applied: PersonRole[] = [];

  if (context.isAssignee) {
    applied.push("assignee");
  }
  if (context.isAuthor) {
    applied.push("author");
  }
  if (context.isReviewer) {
    applied.push("reviewer");
  }

  if (applied.length > 0) {
    return {
      attention,
      match: true,
      appliedRoles: applied,
      optionalRoles: [],
    };
  }

  return {
    attention,
    match: false,
    appliedRoles: [],
    optionalRoles: [],
  };
}

function evaluateReviewRequest(
  attention: ActivityAttentionFilter,
  context: PersonRoleContext,
): AttentionPersonResolution {
  if (context.isReviewer) {
    return {
      attention,
      match: true,
      appliedRoles: ["reviewer"],
      optionalRoles: [],
    };
  }

  return {
    attention,
    match: false,
    appliedRoles: [],
    optionalRoles: [],
  };
}

function evaluateUnansweredMention(
  attention: ActivityAttentionFilter,
  context: PersonRoleContext,
): AttentionPersonResolution {
  if (context.isMentioned) {
    return {
      attention,
      match: true,
      appliedRoles: ["mentioned"],
      optionalRoles: [],
    };
  }

  return {
    attention,
    match: false,
    appliedRoles: [],
    optionalRoles: [],
  };
}

const RESOLVERS: Partial<
  Record<
    ActivityAttentionFilter,
    (
      attention: ActivityAttentionFilter,
      context: PersonRoleContext,
    ) => AttentionPersonResolution
  >
> = {
  issue_backlog: evaluateBacklogIssue,
  issue_stalled: evaluateStalledIssue,
  pr_open_too_long: evaluateStaleOrIdlePr,
  pr_inactive: evaluateStaleOrIdlePr,
  review_requests_pending: evaluateReviewRequest,
  unanswered_mentions: evaluateUnansweredMention,
};

export function evaluateAttentionPersonRule(
  attention: ActivityAttentionFilter,
  context: PersonRoleContext,
): AttentionPersonResolution {
  const resolver = RESOLVERS[attention];
  if (!resolver) {
    return {
      attention,
      match: true,
      appliedRoles: [],
      optionalRoles: [],
    };
  }
  return resolver(attention, context);
}

export function evaluateAttentionPersonRules(
  attentions: ActivityAttentionFilter[],
  context: PersonRoleContext,
): AttentionPersonResolution[] {
  if (!attentions.length) {
    return [];
  }

  return attentions.map((attention) =>
    evaluateAttentionPersonRule(attention, context),
  );
}
