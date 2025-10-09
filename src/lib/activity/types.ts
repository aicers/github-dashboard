export type ActivityItemType = "issue" | "pull_request" | "discussion";

export type IssueProjectStatus =
  | "no_status"
  | "todo"
  | "in_progress"
  | "done"
  | "pending";

export type ActivityStatusFilter =
  | "open"
  | "closed"
  | "merged"
  | IssueProjectStatus;

export type ActivityAttentionFilter =
  | "unanswered_mentions"
  | "review_requests_pending"
  | "pr_open_too_long"
  | "pr_inactive"
  | "issue_backlog"
  | "issue_stalled";

export type ActivityThresholds = {
  unansweredMentionDays?: number;
  reviewRequestDays?: number;
  stalePrDays?: number;
  idlePrDays?: number;
  backlogIssueDays?: number;
  stalledIssueDays?: number;
};

export type ActivityFilters = {
  types?: ActivityItemType[];
  repositoryIds?: string[];
  labelKeys?: string[];
  authorIds?: string[];
  assigneeIds?: string[];
  reviewerIds?: string[];
  mentionedUserIds?: string[];
  commenterIds?: string[];
  reactorIds?: string[];
  statuses?: ActivityStatusFilter[];
  attention?: ActivityAttentionFilter[];
  search?: string | null;
  jumpToDate?: string | null;
  thresholds?: ActivityThresholds;
};

export type ActivityPagination = {
  page?: number;
  perPage?: number;
};

export type ActivityListParams = ActivityFilters & ActivityPagination;

export type ActivityUser = {
  id: string;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type ActivityRepository = {
  id: string;
  name: string | null;
  nameWithOwner: string | null;
};

export type ActivityLabel = {
  key: string;
  name: string;
  repositoryId: string;
  repositoryNameWithOwner: string | null;
};

export type ActivityAttentionFlags = {
  unansweredMention: boolean;
  reviewRequestPending: boolean;
  staleOpenPr: boolean;
  idlePr: boolean;
  backlogIssue: boolean;
  stalledIssue: boolean;
};

export type ActivityItem = {
  id: string;
  type: ActivityItemType;
  number: number | null;
  title: string | null;
  url: string | null;
  state: string | null;
  status: "open" | "closed" | "merged";
  issueProjectStatus: IssueProjectStatus | null;
  repository: ActivityRepository | null;
  author: ActivityUser | null;
  assignees: ActivityUser[];
  reviewers: ActivityUser[];
  mentionedUsers: ActivityUser[];
  commenters: ActivityUser[];
  reactors: ActivityUser[];
  labels: ActivityLabel[];
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  mergedAt: string | null;
  businessDaysOpen?: number | null;
  businessDaysIdle?: number | null;
  businessDaysSinceInProgress?: number | null;
  businessDaysInProgressOpen?: number | null;
  attention: ActivityAttentionFlags;
};

export type ActivityPageInfo = {
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
};

export type ActivityListResult = {
  items: ActivityItem[];
  pageInfo: ActivityPageInfo;
  lastSyncCompletedAt: string | null;
  timezone: string | null;
};

export type ActivityItemDetail = {
  item: ActivityItem;
  body: string | null;
  bodyHtml: string | null;
  raw: unknown;
};

export type ActivityFilterOptions = {
  repositories: ActivityRepository[];
  labels: ActivityLabel[];
  users: ActivityUser[];
};
