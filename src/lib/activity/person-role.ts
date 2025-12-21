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
  if (attention === "pr_reviewer_unassigned") {
    if (context.isMaintainer) {
      return {
        attention,
        match: true,
        appliedRoles: ["maintainer"],
        optionalRoles: [],
      };
    }

    if (context.isAuthor) {
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

  if (attention === "pr_review_stalled") {
    if (context.isMaintainer) {
      return {
        attention,
        match: true,
        appliedRoles: ["maintainer"],
        optionalRoles: [],
      };
    }

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

  if (attention === "pr_merge_delayed") {
    if (context.isAssignee) {
      return {
        attention,
        match: true,
        appliedRoles: ["assignee"],
        optionalRoles: [],
      };
    }

    if (!context.hasAssignee && context.isMaintainer) {
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

  return {
    attention,
    match: true,
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
  pr_reviewer_unassigned: evaluateStaleOrIdlePr,
  pr_review_stalled: evaluateStaleOrIdlePr,
  pr_merge_delayed: evaluateStaleOrIdlePr,
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
