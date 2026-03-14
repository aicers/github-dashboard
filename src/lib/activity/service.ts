import { normalizeProjectTarget } from "@/lib/activity/base-query";
import {
  getCachedActivityFilterOptions,
  getLinkedIssuesMap,
  getLinkedPullRequestsMap,
} from "@/lib/activity/cache";
import { toIso } from "@/lib/activity/data-utils";
import { getProjectFieldOverrides } from "@/lib/activity/project-field-store";
import {
  type ActivityRow,
  type AttentionSets,
  buildActivityItem,
} from "@/lib/activity/service-builders";
import { fetchJumpPage } from "@/lib/activity/service-detail";
import {
  coerceArray,
  coerceSearch,
  DEFAULT_THRESHOLDS,
  fetchRepositoryMaintainers,
  resolveAttentionSets,
  toUserMap,
} from "@/lib/activity/service-utils";
import { ensureIssueStatusAutomation } from "@/lib/activity/status-automation";
import { getActivityStatusHistory } from "@/lib/activity/status-store";
import type {
  ActivityAttentionFilter,
  ActivityDiscussionStatusFilter,
  ActivityFilterOptions,
  ActivityIssueBaseStatusFilter,
  ActivityListParams,
  ActivityListResult,
  ActivityPullRequestStatusFilter,
  ActivityThresholds,
  IssueProjectStatus,
} from "@/lib/activity/types";
import { loadCombinedHolidaySet } from "@/lib/dashboard/business-days";
import { normalizeOrganizationHolidayCodes } from "@/lib/dashboard/holiday-utils";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import { getSyncConfig, getUserProfiles } from "@/lib/db/operations";
import { env } from "@/lib/env";
import { readUserTimeSettings } from "@/lib/user/time-settings";

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

type AttentionFilterWithoutNone = Exclude<
  ActivityAttentionFilter,
  "no_attention"
>;

const ATTENTION_FILTER_KEYS: AttentionFilterWithoutNone[] = [
  "unanswered_mentions",
  "review_requests_pending",
  "pr_reviewer_unassigned",
  "pr_review_stalled",
  "pr_merge_delayed",
  "issue_backlog",
  "issue_stalled",
];

const ISSUE_PROJECT_STATUS_VALUES: IssueProjectStatus[] = [
  "no_status",
  "todo",
  "in_progress",
  "done",
  "pending",
  "canceled",
];

const ISSUE_PROJECT_STATUS_SET = new Set(ISSUE_PROJECT_STATUS_VALUES);

const PR_STATUS_VALUES: ActivityPullRequestStatusFilter[] = [
  "pr_open",
  "pr_merged",
  "pr_closed",
];

const PR_STATUS_MAP: Record<
  ActivityPullRequestStatusFilter,
  "open" | "closed" | "merged"
> = {
  pr_open: "open",
  pr_merged: "merged",
  pr_closed: "closed",
};

const ISSUE_BASE_STATUS_VALUES: ActivityIssueBaseStatusFilter[] = [
  "issue_open",
  "issue_closed",
];

const ISSUE_BASE_STATUS_MAP: Record<
  ActivityIssueBaseStatusFilter,
  "open" | "closed"
> = {
  issue_open: "open",
  issue_closed: "closed",
};

const DISCUSSION_STATUS_VALUES: ActivityDiscussionStatusFilter[] = [
  "discussion_open",
  "discussion_closed",
];

const DISCUSSION_STATUS_MAP: Record<
  ActivityDiscussionStatusFilter,
  "open" | "closed"
> = {
  discussion_open: "open",
  discussion_closed: "closed",
};

type AttentionFilterSelection = {
  includeIds: string[];
  includeNone: boolean;
};

function collectAttentionFilterIds(
  filters: ActivityAttentionFilter[] | undefined,
  sets: AttentionSets,
): AttentionFilterSelection | null {
  if (!filters?.length) {
    return null;
  }

  const union = new Set<string>();
  let includeNone = false;
  filters.forEach((filter) => {
    switch (filter) {
      case "unanswered_mentions":
        for (const id of sets.unansweredMentions) {
          union.add(id);
        }
        break;
      case "review_requests_pending":
        for (const id of sets.reviewRequests) {
          union.add(id);
        }
        break;
      case "pr_reviewer_unassigned":
        for (const id of sets.reviewerUnassignedPullRequests) {
          union.add(id);
        }
        break;
      case "pr_review_stalled":
        for (const id of sets.reviewStalledPullRequests) {
          union.add(id);
        }
        break;
      case "pr_merge_delayed":
        for (const id of sets.mergeDelayedPullRequests) {
          union.add(id);
        }
        break;
      case "issue_backlog":
        for (const id of sets.backlogIssues) {
          union.add(id);
        }
        break;
      case "issue_stalled":
        for (const id of sets.stalledIssues) {
          union.add(id);
        }
        break;
      case "no_attention":
        includeNone = true;
        break;
      default:
        break;
    }
  });

  return {
    includeIds: Array.from(union),
    includeNone,
  };
}

function buildQueryFilters(
  params: ActivityListParams,
  attentionSets: AttentionSets,
  excludedRepositoryIds: string[] = [],
): {
  clauses: string[];
  values: unknown[];
  issueProjectStatuses: IssueProjectStatus[];
  peopleSelection: string[];
  peopleSelectionParamIndex: number | null;
} {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const issueProjectStatuses: IssueProjectStatus[] = [];
  let peopleSelection: string[] = [];
  let peopleSelectionParamIndex: number | null = null;
  const excludedRepoIds = excludedRepositoryIds.filter(
    (id) => typeof id === "string" && id.length > 0,
  );

  if (excludedRepoIds.length > 0) {
    values.push(excludedRepoIds);
    clauses.push(
      `(items.repository_id IS NULL OR items.repository_id <> ALL($${values.length}::text[]))`,
    );
  }
  const buildNormalizedStatusExpr = (alias: string) => {
    const valueExpr = `LOWER(TRIM(${alias}.issue_display_status))`;
    return `(CASE
      WHEN ${alias}.item_type <> 'issue' THEN NULL
      WHEN ${alias}.issue_display_status IS NULL THEN 'no_status'
      WHEN ${valueExpr} = '' THEN 'no_status'
      WHEN ${valueExpr} IN ('todo', 'to do', 'to_do') THEN 'todo'
      WHEN ${valueExpr} LIKE '%progress%' OR ${valueExpr} = 'doing' OR ${valueExpr} = 'in-progress' THEN 'in_progress'
      WHEN ${valueExpr} IN ('done', 'completed', 'complete', 'finished', 'closed') THEN 'done'
      WHEN ${valueExpr} LIKE 'pending%' OR ${valueExpr} = 'waiting' THEN 'pending'
      WHEN ${valueExpr} IN ('canceled', 'cancelled') THEN 'canceled'
      ELSE 'no_status'
    END)`;
  };

  const haveSameMembers = (first: string[], second: string[]) => {
    if (first.length !== second.length) {
      return false;
    }
    const baseline = new Set(first);
    if (baseline.size !== second.length) {
      return false;
    }
    return second.every((value) => baseline.has(value));
  };

  const mergedStringSet = (values: string[]) =>
    Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));

  const peopleFiltersConfig = [
    {
      values: params.authorIds ?? [],
      buildClause: (parameterIndex: number) =>
        `items.author_id = ANY($${parameterIndex}::text[])`,
    },
    {
      values: params.assigneeIds ?? [],
      buildClause: (parameterIndex: number) =>
        `COALESCE(items.assignee_ids && $${parameterIndex}::text[], FALSE)`,
    },
    {
      values: params.reviewerIds ?? [],
      buildClause: (parameterIndex: number) =>
        `COALESCE(items.reviewer_ids && $${parameterIndex}::text[], FALSE)`,
    },
    {
      values: params.mentionedUserIds ?? [],
      buildClause: (parameterIndex: number) =>
        `COALESCE(items.mentioned_ids && $${parameterIndex}::text[], FALSE)`,
    },
    {
      values: params.commenterIds ?? [],
      buildClause: (parameterIndex: number) =>
        `COALESCE(items.commenter_ids && $${parameterIndex}::text[], FALSE)`,
    },
    {
      values: params.reactorIds ?? [],
      buildClause: (parameterIndex: number) =>
        `COALESCE(items.reactor_ids && $${parameterIndex}::text[], FALSE)`,
    },
    {
      values: params.maintainerIds ?? [],
      buildClause: (parameterIndex: number) =>
        `EXISTS (
           SELECT 1
           FROM repository_maintainers rm
           WHERE rm.repository_id = items.repository_id
             AND rm.user_id = ANY($${parameterIndex}::text[])
         )`,
    },
  ] as const;

  const populatedPeopleFilters = peopleFiltersConfig.filter(
    (entry) => entry.values.length > 0,
  );

  let peopleFiltersHandled = false;
  let peopleSelectionValues: string[] | null = null;

  const ensurePeopleSelectionParam = () => {
    if (!peopleSelectionValues || peopleSelectionValues.length === 0) {
      return null;
    }
    if (peopleSelectionParamIndex === null) {
      values.push(peopleSelectionValues);
      peopleSelectionParamIndex = values.length;
    }
    return peopleSelectionParamIndex;
  };

  const unansweredMentionTargets = new Map<string, Set<string>>();
  attentionSets.mentionDetails.forEach((details, itemId) => {
    const targets = new Set<string>();
    details.forEach((detail) => {
      const targetId = detail.target?.id?.trim();
      if (targetId) {
        targets.add(targetId);
      }
    });
    if (targets.size > 0) {
      unansweredMentionTargets.set(itemId, targets);
    }
  });

  if (populatedPeopleFilters.length > 0) {
    const baselineValues = mergedStringSet(
      populatedPeopleFilters[0]?.values ?? [],
    );
    const isSyncedSelection = populatedPeopleFilters.every((entry) =>
      haveSameMembers(baselineValues, mergedStringSet(entry.values)),
    );

    if (isSyncedSelection) {
      peopleSelection = baselineValues;
      peopleSelectionValues = baselineValues;
      const hasActiveAttention =
        params.attention?.some((value) => value !== "no_attention") ?? false;
      if (!hasActiveAttention) {
        const parameterIndex = ensurePeopleSelectionParam();
        if (parameterIndex !== null) {
          const peopleClauses = populatedPeopleFilters.map((entry) =>
            entry.buildClause(parameterIndex),
          );
          clauses.push(`(${peopleClauses.join(" OR ")})`);
          peopleFiltersHandled = true;
        }
      } else {
        peopleFiltersHandled = true;
      }
    }
  }

  if (!peopleSelectionValues && params.peopleSelection?.length) {
    const uniqueSelection = mergedStringSet(params.peopleSelection);
    if (uniqueSelection.length > 0) {
      peopleSelection = uniqueSelection;
      peopleSelectionValues = uniqueSelection;
    }
  }

  if (params.taskMode === "my_todo") {
    const selectionSet =
      peopleSelection.length > 0
        ? new Set(
            peopleSelection
              .map((value) => value?.trim())
              .filter((value): value is string => Boolean(value)),
          )
        : null;
    const selectionParamIndex = ensurePeopleSelectionParam();
    if (
      !selectionSet ||
      selectionSet.size === 0 ||
      selectionParamIndex === null
    ) {
      clauses.push("FALSE");
    } else {
      const assigneeCardinalityExpr =
        "COALESCE(array_length(items.assignee_ids, 1), 0)";
      const hasAssigneeExpr = `${assigneeCardinalityExpr} > 0`;
      const noAssigneeExpr = `${assigneeCardinalityExpr} = 0`;
      const buildAssigneeExpr = (index: number) =>
        `COALESCE(items.assignee_ids && $${index}::text[], FALSE)`;
      const buildMaintainerExpr = (index: number) =>
        `EXISTS (
           SELECT 1
           FROM repository_maintainers rm
           WHERE rm.repository_id = items.repository_id
             AND rm.user_id = ANY($${index}::text[])
         )`;
      const buildAuthorExpr = (index: number) =>
        `items.author_id = ANY($${index}::text[])`;
      const buildReviewerExpr = (index: number) =>
        `COALESCE(items.reviewer_ids && $${index}::text[], FALSE)`;

      const issueClause = `(items.item_type = 'issue' AND items.status = 'open' AND ((${hasAssigneeExpr} AND ${buildAssigneeExpr(
        selectionParamIndex,
      )}) OR (${noAssigneeExpr} AND ${buildMaintainerExpr(
        selectionParamIndex,
      )})))`;
      const pullRequestClause = `(items.item_type = 'pull_request' AND items.status = 'open' AND (${buildAuthorExpr(
        selectionParamIndex,
      )} OR ${buildReviewerExpr(selectionParamIndex)}))`;

      const mentionIds = Array.from(attentionSets.unansweredMentions).filter(
        (itemId) => {
          const targets = unansweredMentionTargets.get(itemId);
          if (!targets || targets.size === 0) {
            return false;
          }
          for (const candidate of selectionSet) {
            if (targets.has(candidate)) {
              return true;
            }
          }
          return false;
        },
      );

      const todoClauses = [issueClause, pullRequestClause];
      if (mentionIds.length > 0) {
        values.push(mentionIds);
        const mentionParameterIndex = values.length;
        todoClauses.push(`items.id = ANY($${mentionParameterIndex}::text[])`);
      }

      clauses.push(`(${todoClauses.join(" OR ")})`);
    }
  }

  const applyAttentionFilters = () => {
    if (!params.attention?.length) {
      return;
    }

    const uniqueFilters = Array.from(new Set(params.attention));
    if (uniqueFilters.length === 0) {
      return;
    }

    const includeNone = uniqueFilters.includes("no_attention");
    const activeFilters = uniqueFilters.filter(
      (value): value is AttentionFilterWithoutNone => value !== "no_attention",
    );

    const buildAttentionClause = (
      filter: AttentionFilterWithoutNone,
    ): string | null => {
      let ids: string[] = [];
      const constraints: string[] = [];
      const selectionSet =
        peopleSelection.length > 0
          ? new Set(
              peopleSelection
                .map((value) => value?.trim())
                .filter((value): value is string => Boolean(value)),
            )
          : null;

      const assigneeCardinalityExpr =
        "COALESCE(array_length(items.assignee_ids, 1), 0)";
      const hasAssigneeExpr = `${assigneeCardinalityExpr} > 0`;
      const noAssigneeExpr = `${assigneeCardinalityExpr} = 0`;
      const maintainerExistsExpr = `EXISTS (
         SELECT 1
         FROM repository_maintainers rm
         WHERE rm.repository_id = items.repository_id
       )`;

      const buildAssigneeExpr = (index: number) =>
        `COALESCE(items.assignee_ids && $${index}::text[], FALSE)`;
      const buildReviewerExpr = (index: number) =>
        `COALESCE(items.reviewer_ids && $${index}::text[], FALSE)`;
      const buildMentionedExpr = (index: number) =>
        `COALESCE(items.mentioned_ids && $${index}::text[], FALSE)`;
      const buildAuthorExpr = (index: number) =>
        `items.author_id = ANY($${index}::text[])`;
      const buildMaintainerExpr = (index: number) =>
        `EXISTS (
         SELECT 1
         FROM repository_maintainers rm
         WHERE rm.repository_id = items.repository_id
           AND rm.user_id = ANY($${index}::text[])
       )`;

      const withPeopleConstraint = (
        builder: (index: number) => string,
        options?: { required?: boolean },
      ) => {
        const paramIndex = ensurePeopleSelectionParam();
        if (paramIndex === null) {
          return options?.required ? null : undefined;
        }
        return builder(paramIndex);
      };

      switch (filter) {
        case "unanswered_mentions": {
          ids = Array.from(attentionSets.unansweredMentions);
          if (selectionSet && selectionSet.size > 0) {
            ids = ids.filter((itemId) => {
              const targets = unansweredMentionTargets.get(itemId);
              if (!targets || targets.size === 0) {
                return false;
              }
              for (const candidate of selectionSet) {
                if (targets.has(candidate)) {
                  return true;
                }
              }
              return false;
            });
            if (ids.length === 0) {
              return null;
            }
            const mentionExpr = withPeopleConstraint(buildMentionedExpr, {
              required: true,
            });
            if (!mentionExpr) {
              return null;
            }
            constraints.push(mentionExpr);
          }
          break;
        }
        case "review_requests_pending":
          ids = Array.from(attentionSets.reviewRequests);
          if (selectionSet && selectionSet.size > 0) {
            ids = ids.filter((pullRequestId) => {
              const requests =
                attentionSets.reviewRequestDetails.get(pullRequestId) ?? [];
              return requests.some((request) => {
                const reviewerId = request.reviewer?.id;
                return reviewerId ? selectionSet.has(reviewerId) : false;
              });
            });
            if (ids.length === 0) {
              return null;
            }
          }
          constraints.push(`items.item_type = 'pull_request'`);
          break;
        case "pr_reviewer_unassigned": {
          ids = Array.from(attentionSets.reviewerUnassignedPullRequests);
          constraints.push(`items.item_type = 'pull_request'`);
          constraints.push(`items.status = 'open'`);
          break;
        }
        case "pr_review_stalled": {
          ids = Array.from(attentionSets.reviewStalledPullRequests);
          constraints.push(`items.item_type = 'pull_request'`);
          constraints.push(`items.status = 'open'`);
          break;
        }
        case "pr_merge_delayed": {
          ids = Array.from(attentionSets.mergeDelayedPullRequests);
          constraints.push(`items.item_type = 'pull_request'`);
          constraints.push(`items.status = 'open'`);
          break;
        }
        case "issue_backlog":
          ids = Array.from(attentionSets.backlogIssues);
          constraints.push(`items.item_type = 'issue'`);
          break;
        case "issue_stalled":
          ids = Array.from(attentionSets.stalledIssues);
          constraints.push(`items.item_type = 'issue'`);
          break;
        default:
          return null;
      }

      if (ids.length === 0) {
        return null;
      }

      if (selectionSet && selectionSet.size > 0) {
        switch (filter) {
          case "review_requests_pending":
            break;
          case "pr_reviewer_unassigned": {
            const authorExpr = withPeopleConstraint(buildAuthorExpr);
            const maintainerExpr = withPeopleConstraint(buildMaintainerExpr);
            const parts = [authorExpr, maintainerExpr].filter(
              (expr): expr is string => Boolean(expr),
            );
            if (parts.length) {
              constraints.push(`(${parts.join(" OR ")})`);
            }
            break;
          }
          case "pr_review_stalled": {
            const reviewerExpr = withPeopleConstraint(buildReviewerExpr);
            const maintainerExpr = withPeopleConstraint(buildMaintainerExpr);
            const parts = [reviewerExpr, maintainerExpr].filter(
              (expr): expr is string => Boolean(expr),
            );
            if (parts.length) {
              constraints.push(`(${parts.join(" OR ")})`);
            }
            break;
          }
          case "pr_merge_delayed": {
            const paramIndex = ensurePeopleSelectionParam();
            if (paramIndex !== null) {
              const personIsAssigneeExpr = buildAssigneeExpr(paramIndex);
              const personIsMaintainerExpr = buildMaintainerExpr(paramIndex);
              const personIsAuthorExpr = buildAuthorExpr(paramIndex);
              constraints.push(
                `((${hasAssigneeExpr} AND ${personIsAssigneeExpr}) OR (${noAssigneeExpr} AND ${maintainerExistsExpr} AND ${personIsMaintainerExpr}) OR (${noAssigneeExpr} AND NOT ${maintainerExistsExpr} AND ${personIsAuthorExpr}))`,
              );
            }
            break;
          }
          case "issue_backlog": {
            const maintainerExpr = withPeopleConstraint(buildMaintainerExpr);
            if (maintainerExpr) {
              constraints.push(maintainerExpr);
            }
            break;
          }
          case "issue_stalled": {
            const paramIndex = ensurePeopleSelectionParam();
            if (paramIndex !== null) {
              const personIsAssigneeExpr = buildAssigneeExpr(paramIndex);
              const personIsMaintainerExpr = buildMaintainerExpr(paramIndex);
              const personIsAuthorExpr = buildAuthorExpr(paramIndex);
              constraints.push(
                `((${hasAssigneeExpr} AND ${personIsAssigneeExpr}) OR (${noAssigneeExpr} AND ${maintainerExistsExpr} AND ${personIsMaintainerExpr}) OR (${noAssigneeExpr} AND NOT ${maintainerExistsExpr} AND ${personIsAuthorExpr}))`,
              );
            }
            break;
          }
          default:
            break;
        }
      }

      values.push(ids);
      const parameterIndex = values.length;
      const baseClause = `items.id = ANY($${parameterIndex}::text[])`;
      if (!constraints.length) {
        return baseClause;
      }
      return `(${baseClause} AND ${constraints.join(" AND ")})`;
    };

    const attentionClauses = activeFilters
      .map((filter) => buildAttentionClause(filter))
      .filter((clause): clause is string => Boolean(clause));

    if (!includeNone) {
      if (attentionClauses.length === 0 && activeFilters.length > 0) {
        clauses.push("FALSE");
        return;
      }
      if (attentionClauses.length > 0) {
        clauses.push(`(${attentionClauses.join(" OR ")})`);
      }
      return;
    }

    const exclusionClauses = ATTENTION_FILTER_KEYS.map((filter) =>
      buildAttentionClause(filter),
    ).filter((clause): clause is string => Boolean(clause));

    const combinedMatch =
      attentionClauses.length > 0 ? `(${attentionClauses.join(" OR ")})` : null;
    const combinedExclusion =
      exclusionClauses.length > 0 ? `(${exclusionClauses.join(" OR ")})` : null;

    if (combinedMatch && combinedExclusion) {
      clauses.push(`(${combinedMatch} OR NOT ${combinedExclusion})`);
    } else if (combinedMatch) {
      clauses.push(combinedMatch);
    } else if (combinedExclusion) {
      clauses.push(`NOT ${combinedExclusion}`);
    }
  };

  applyAttentionFilters();

  if (params.types?.length) {
    values.push(params.types);
    clauses.push(`items.item_type = ANY($${values.length}::text[])`);
  }

  if (params.repositoryIds?.length) {
    values.push(params.repositoryIds);
    clauses.push(`items.repository_id = ANY($${values.length}::text[])`);
  }

  if (params.labelKeys?.length) {
    values.push(params.labelKeys);
    clauses.push(`items.label_keys && $${values.length}::text[]`);
  }

  if (params.issueTypeIds?.length) {
    values.push(params.issueTypeIds);
    clauses.push(
      `(items.item_type <> 'issue' OR items.issue_type_id = ANY($${values.length}::text[]))`,
    );
  }

  if (params.issuePriorities?.length) {
    values.push(params.issuePriorities);
    clauses.push(
      `(items.item_type <> 'issue' OR items.issue_priority_value = ANY($${values.length}::text[]))`,
    );
  }

  if (params.issueWeights?.length) {
    values.push(params.issueWeights);
    clauses.push(
      `(items.item_type <> 'issue' OR items.issue_weight_value = ANY($${values.length}::text[]))`,
    );
  }

  if (params.milestoneIds?.length) {
    values.push(params.milestoneIds);
    clauses.push(
      `(items.item_type <> 'issue' OR items.milestone_id = ANY($${values.length}::text[]))`,
    );
  }

  if (params.discussionStatuses?.length) {
    const unique = Array.from(new Set(params.discussionStatuses));
    if (unique.length > 0 && unique.length < DISCUSSION_STATUS_VALUES.length) {
      const mapped = unique.map((status) => DISCUSSION_STATUS_MAP[status]);
      values.push(mapped);
      clauses.push(
        `(items.item_type <> 'discussion' OR items.status = ANY($${values.length}::text[]))`,
      );
    }
  }

  if (params.pullRequestStatuses?.length) {
    const unique = Array.from(new Set(params.pullRequestStatuses));
    if (unique.length > 0 && unique.length < PR_STATUS_VALUES.length) {
      const mapped = unique.map((status) => PR_STATUS_MAP[status]);
      values.push(mapped);
      clauses.push(
        `(items.item_type <> 'pull_request' OR items.status = ANY($${values.length}::text[]))`,
      );
    }
  }

  if (params.issueBaseStatuses?.length) {
    const unique = Array.from(new Set(params.issueBaseStatuses));
    if (unique.length > 0 && unique.length < ISSUE_BASE_STATUS_VALUES.length) {
      const mapped = unique.map((status) => ISSUE_BASE_STATUS_MAP[status]);
      values.push(mapped);
      clauses.push(
        `(items.item_type <> 'issue' OR items.status = ANY($${values.length}::text[]))`,
      );
    }
  }

  if (!peopleFiltersHandled && params.authorIds?.length) {
    values.push(params.authorIds);
    clauses.push(`items.author_id = ANY($${values.length}::text[])`);
  }

  if (!peopleFiltersHandled && params.assigneeIds?.length) {
    const unique = mergedStringSet(params.assigneeIds);
    values.push(unique);
    clauses.push(
      `COALESCE(items.assignee_ids && $${values.length}::text[], FALSE)`,
    );
  }

  if (!peopleFiltersHandled && params.reviewerIds?.length) {
    const unique = mergedStringSet(params.reviewerIds);
    values.push(unique);
    clauses.push(
      `COALESCE(items.reviewer_ids && $${values.length}::text[], FALSE)`,
    );
  }

  if (!peopleFiltersHandled && params.mentionedUserIds?.length) {
    const unique = mergedStringSet(params.mentionedUserIds);
    values.push(unique);
    clauses.push(
      `COALESCE(items.mentioned_ids && $${values.length}::text[], FALSE)`,
    );
  }

  if (!peopleFiltersHandled && params.commenterIds?.length) {
    const unique = mergedStringSet(params.commenterIds);
    values.push(unique);
    clauses.push(
      `COALESCE(items.commenter_ids && $${values.length}::text[], FALSE)`,
    );
  }

  if (!peopleFiltersHandled && params.reactorIds?.length) {
    const unique = mergedStringSet(params.reactorIds);
    values.push(unique);
    clauses.push(
      `COALESCE(items.reactor_ids && $${values.length}::text[], FALSE)`,
    );
  }

  if (params.linkedIssueStates?.length) {
    const filters = new Set(params.linkedIssueStates);
    if (filters.has("has_sub")) {
      clauses.push(
        `(items.item_type <> 'issue' OR items.tracked_issues_count > 0)`,
      );
    }
    if (filters.has("has_parent")) {
      clauses.push(
        `(items.item_type <> 'issue' OR items.tracked_issues_count = 0)`,
      );
    }
  }

  if (params.statuses?.length) {
    const statuses = params.statuses;
    const baseStatuses = statuses.filter(
      (status): status is "open" | "closed" =>
        status === "open" || status === "closed",
    );
    const includeMerged = statuses.includes("merged");
    issueProjectStatuses.push(
      ...statuses.filter((status): status is IssueProjectStatus =>
        ISSUE_PROJECT_STATUS_SET.has(status as IssueProjectStatus),
      ),
    );

    if (baseStatuses.length || includeMerged) {
      if (includeMerged) {
        values.push(["merged"]);
        const mergedIndex = values.length;
        if (baseStatuses.length) {
          values.push(baseStatuses);
          clauses.push(
            `((items.item_type = 'pull_request' AND items.status = ANY($${mergedIndex}::text[])) OR (items.item_type <> 'pull_request' AND items.status = ANY($${values.length}::text[])))`,
          );
        } else {
          clauses.push(
            `items.item_type = 'pull_request' AND items.status = ANY($${mergedIndex}::text[])`,
          );
        }
      } else {
        values.push(baseStatuses);
        clauses.push(`items.status = ANY($${values.length}::text[])`);
      }
    }

    if (issueProjectStatuses.length) {
      const uniqueIssueStatuses = Array.from(new Set(issueProjectStatuses));
      values.push(uniqueIssueStatuses);
      const issueStatusParamIndex = values.length;
      const normalizedStatusExpr = buildNormalizedStatusExpr("items");
      clauses.push(
        `(items.item_type <> 'issue' OR ${normalizedStatusExpr} = ANY($${issueStatusParamIndex}::text[]))`,
      );
      issueProjectStatuses.splice(
        0,
        issueProjectStatuses.length,
        ...uniqueIssueStatuses,
      );
    }
  }

  const search = coerceSearch(params.search);
  if (search) {
    const pattern = `%${search}%`;
    values.push(pattern);
    const patternIndex = values.length;
    values.push(pattern);
    const commentIndex = values.length;
    clauses.push(
      `(items.title ILIKE $${patternIndex} OR items.body_text ILIKE $${patternIndex} OR EXISTS (
         SELECT 1 FROM comments c
         WHERE (
           (items.item_type IN ('issue', 'discussion') AND c.issue_id = items.id) OR
           (items.item_type = 'pull_request' AND c.pull_request_id = items.id)
         )
         AND c.data->>'body' ILIKE $${commentIndex}
       ))`,
    );
  }

  return {
    clauses,
    values,
    issueProjectStatuses,
    peopleSelection,
    peopleSelectionParamIndex,
  };
}

export async function getActivityFilterOptions(): Promise<ActivityFilterOptions> {
  await ensureSchema();
  return getCachedActivityFilterOptions();
}

export async function getActivityItems(
  params: ActivityListParams = {},
  options?: { userId?: string | null },
): Promise<ActivityListResult> {
  await ensureSchema();

  try {
    await ensureIssueStatusAutomation({ trigger: "activity:view" });
  } catch (error) {
    console.error(
      "[status-automation] Verification failed while loading activity items",
      error,
    );
  }

  const thresholds: Required<ActivityThresholds> = {
    ...DEFAULT_THRESHOLDS,
    ...params.thresholds,
  };
  thresholds.unansweredMentionDays = Math.max(
    1,
    thresholds.unansweredMentionDays,
  );
  thresholds.reviewRequestDays = Math.max(1, thresholds.reviewRequestDays);
  thresholds.reviewerUnassignedPrDays = Math.max(
    1,
    thresholds.reviewerUnassignedPrDays,
  );
  thresholds.reviewStalledPrDays = Math.max(1, thresholds.reviewStalledPrDays);
  thresholds.mergeDelayedPrDays = Math.max(1, thresholds.mergeDelayedPrDays);

  const targetProject = normalizeProjectTarget(env.TODO_PROJECT_NAME);

  let page = Math.max(1, params.page ?? 1);

  const attentionSets = await resolveAttentionSets(thresholds, {
    userId: options?.userId ?? null,
    useMentionClassifier: params.useMentionAi !== false,
  });
  const attentionSelection = collectAttentionFilterIds(
    params.attention,
    attentionSets,
  );
  const [config, userTimeSettings] = await Promise.all([
    getSyncConfig(),
    readUserTimeSettings(options?.userId ?? null),
  ]);
  const perPagePreference = Math.min(
    MAX_PER_PAGE,
    Math.max(1, userTimeSettings.activityRowsPerPage ?? DEFAULT_PER_PAGE),
  );
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, params.perPage ?? perPagePreference),
  );
  const organizationHolidayCodes = normalizeOrganizationHolidayCodes(config);
  const organizationHolidaySet = await loadCombinedHolidaySet(
    organizationHolidayCodes,
  );
  const excludedRepositoryIds = Array.from(
    new Set(
      Array.isArray(config?.excluded_repository_ids)
        ? (config.excluded_repository_ids as unknown[])
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        : [],
    ),
  );
  const dateTimeFormat = userTimeSettings.dateTimeFormat;
  const trimmedTimezone = userTimeSettings.timezone.trim();
  const timezone = trimmedTimezone.length ? trimmedTimezone : null;
  const lastSyncCompletedAt = toIso(config?.last_sync_completed_at ?? null);
  const generatedAt = new Date().toISOString();

  if (
    attentionSelection &&
    !attentionSelection.includeNone &&
    attentionSelection.includeIds.length === 0
  ) {
    return {
      items: [],
      pageInfo: {
        page,
        perPage,
        totalCount: 0,
        totalPages: 0,
      },
      lastSyncCompletedAt,
      generatedAt,
      timezone,
      dateTimeFormat,
    };
  }

  const { clauses, values } = buildQueryFilters(
    params,
    attentionSets,
    excludedRepositoryIds,
  );

  if (params.jumpToDate) {
    const jumpPage = await fetchJumpPage(
      clauses,
      values,
      perPage,
      params.jumpToDate,
    );
    if (jumpPage && Number.isFinite(jumpPage) && jumpPage > 0) {
      page = jumpPage;
    }
  }

  const offset = (page - 1) * perPage;
  const predicate = clauses.length
    ? ` AND ${clauses.map((clause) => `(${clause})`).join(" AND ")}`
    : "";
  const limitIndex = values.length + 1;
  const offsetIndex = values.length + 2;
  const fetchLimit = perPage;
  const queryParams = [...values, fetchLimit, offset];

  const result = await query<ActivityRow>(
    `SELECT
       items.*
     FROM activity_items AS items
     WHERE 1 = 1${predicate}
     ORDER BY items.updated_at DESC NULLS LAST, items.created_at DESC
    LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    queryParams,
  );

  const rows = result.rows;

  const issueIds = rows
    .filter((row) => row.item_type === "issue")
    .map((row) => row.id);
  const pullRequestIds = rows
    .filter((row) => row.item_type === "pull_request")
    .map((row) => row.id);
  const repositoryIds = Array.from(
    new Set(
      rows
        .map((row) => row.repository_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const [
    activityStatusHistory,
    projectOverrides,
    linkedPullRequestsMap,
    linkedIssuesMap,
    repositoryMaintainers,
  ] = await Promise.all([
    getActivityStatusHistory(issueIds),
    getProjectFieldOverrides(issueIds),
    getLinkedPullRequestsMap(issueIds),
    getLinkedIssuesMap(pullRequestIds),
    fetchRepositoryMaintainers(repositoryIds),
  ]);

  const userIds = new Set<string>();
  for (const row of rows) {
    if (row.author_id) {
      userIds.add(row.author_id);
    }
    for (const id of coerceArray(row.assignee_ids)) {
      userIds.add(id);
    }
    for (const id of coerceArray(row.reviewer_ids)) {
      userIds.add(id);
    }
    for (const id of coerceArray(row.mentioned_ids)) {
      userIds.add(id);
    }
    for (const id of coerceArray(row.commenter_ids)) {
      userIds.add(id);
    }
    for (const id of coerceArray(row.reactor_ids)) {
      userIds.add(id);
    }
  }

  const profiles = await getUserProfiles(Array.from(userIds));
  const users = toUserMap(profiles);

  const now = new Date();

  const items = rows.map((row) =>
    buildActivityItem(
      row,
      users,
      attentionSets,
      targetProject,
      organizationHolidaySet,
      now,
      projectOverrides,
      activityStatusHistory,
      linkedIssuesMap,
      linkedPullRequestsMap,
      repositoryMaintainers,
    ),
  );

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM activity_items AS items
     WHERE 1 = 1${predicate}`,
    values,
  );

  const totalCount = Number(countResult.rows[0]?.count ?? 0);
  const totalPages =
    totalCount > 0 && perPage > 0
      ? Math.ceil(totalCount / perPage)
      : totalCount > 0
        ? 1
        : 0;

  return {
    items,
    pageInfo: {
      page,
      perPage,
      totalCount,
      totalPages,
    },
    lastSyncCompletedAt,
    generatedAt,
    timezone,
    dateTimeFormat,
  };
}

// ---- Barrel re-exports ----
// Preserve existing import paths for consumers using @/lib/activity/service.

export { getActivityItemDetail } from "@/lib/activity/service-detail";
