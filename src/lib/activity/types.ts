import type { DateTimeDisplayFormat } from "@/lib/date-time-format";

export type ActivityItemType = "issue" | "pull_request" | "discussion";

export type IssueProjectStatus =
  | "no_status"
  | "todo"
  | "in_progress"
  | "done"
  | "pending"
  | "canceled";

export type ActivityStatusFilter =
  | "open"
  | "closed"
  | "merged"
  | IssueProjectStatus;

export type ActivityPullRequestStatusFilter =
  | "pr_open"
  | "pr_merged"
  | "pr_closed";

export type ActivityDiscussionStatusFilter =
  | "discussion_open"
  | "discussion_closed";

export type ActivityIssueBaseStatusFilter = "issue_open" | "issue_closed";

export type ActivityIssuePriorityFilter = "P0" | "P1" | "P2";

export type ActivityIssueWeightFilter = "Heavy" | "Medium" | "Light";

export type ActivityAttentionFilter =
  | "unanswered_mentions"
  | "review_requests_pending"
  | "pr_open_too_long"
  | "pr_inactive"
  | "issue_backlog"
  | "issue_stalled"
  | "no_attention";

export type ActivityThresholds = {
  unansweredMentionDays?: number;
  reviewRequestDays?: number;
  stalePrDays?: number;
  idlePrDays?: number;
  backlogIssueDays?: number;
  stalledIssueDays?: number;
};

export type PeopleRoleKey =
  | "authorIds"
  | "assigneeIds"
  | "reviewerIds"
  | "mentionedUserIds"
  | "commenterIds"
  | "reactorIds"
  | "maintainerIds";

export type OptionalPeopleMap = Partial<Record<PeopleRoleKey, string[]>>;
export type PeopleFilterMap = Record<PeopleRoleKey, string[]>;

export type ActivityTaskMode = "my_todo";

export type ActivityFilters = {
  types?: ActivityItemType[];
  repositoryIds?: string[];
  labelKeys?: string[];
  issueTypeIds?: string[];
  issuePriorities?: ActivityIssuePriorityFilter[];
  issueWeights?: ActivityIssueWeightFilter[];
  milestoneIds?: string[];
  discussionStatuses?: ActivityDiscussionStatusFilter[];
  pullRequestStatuses?: ActivityPullRequestStatusFilter[];
  issueBaseStatuses?: ActivityIssueBaseStatusFilter[];
  authorIds?: string[];
  assigneeIds?: string[];
  reviewerIds?: string[];
  mentionedUserIds?: string[];
  commenterIds?: string[];
  reactorIds?: string[];
  maintainerIds?: string[];
  peopleSelection?: string[];
  optionalPersonIds?: OptionalPeopleMap;
  statuses?: ActivityStatusFilter[];
  attention?: ActivityAttentionFilter[];
  linkedIssueStates?: ActivityLinkedIssueFilter[];
  search?: string | null;
  jumpToDate?: string | null;
  thresholds?: ActivityThresholds;
  taskMode?: ActivityTaskMode;
  useMentionAi?: boolean;
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
  maintainerIds?: string[];
};

export type ActivityLabel = {
  key: string;
  name: string;
  repositoryId: string;
  repositoryNameWithOwner: string | null;
};

export type ActivityIssueType = {
  id: string;
  name: string | null;
};

export type ActivityMilestone = {
  id: string;
  title: string | null;
  state: string | null;
  dueOn: string | null;
  url: string | null;
};

export type ActivityAttentionFlags = {
  unansweredMention: boolean;
  reviewRequestPending: boolean;
  staleOpenPr: boolean;
  idlePr: boolean;
  backlogIssue: boolean;
  stalledIssue: boolean;
};

export type ActivityLinkedIssue = {
  id: string;
  number: number | null;
  title: string | null;
  state: string | null;
  repositoryNameWithOwner: string | null;
  url: string | null;
};

export type ActivityLinkedPullRequestStatus = "open" | "closed" | "merged";

export type ActivityLinkedPullRequest = {
  id: string;
  number: number | null;
  title: string | null;
  state: string | null;
  status: ActivityLinkedPullRequestStatus;
  repositoryNameWithOwner: string | null;
  url: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string | null;
};

export type ActivityItemComment = {
  id: string;
  author: ActivityUser | null;
  body: string | null;
  bodyHtml: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
  reviewId: string | null;
  replyToId: string | null;
  isAnswer?: boolean | null;
  reactions: ActivityReactionGroup[];
  commitContext?: {
    repository: string;
    commitOid: string;
    path: string | null;
    line: number | null;
    diffHunk: string | null;
  } | null;
  projectContext?: {
    projectName: string;
    fieldName: string | null;
    fieldValue: string | null;
  } | null;
  reviewerContext?: {
    reviewStateLabel: string | null;
    filePath: string | null;
    line: number | null;
    diffHunk: string | null;
  } | null;
};

export type ActivityLinkedIssueFilter = "has_parent" | "has_sub";

export type ActivityReviewRequestWait = {
  id: string;
  reviewer: ActivityUser | null;
  requestedAt: string | null;
  businessDaysWaiting: number | null;
};

export type ActivityMentionWait = {
  id: string;
  user: ActivityUser | null;
  userId: string | null;
  mentionedAt: string | null;
  businessDaysWaiting: number | null;
  requiresResponse: boolean | null;
  manualRequiresResponse: boolean | null;
  manualRequiresResponseAt: string | null;
  manualDecisionIsStale: boolean;
  classifierEvaluatedAt: string | null;
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
  issueProjectStatusSource: "todo_project" | "activity" | "none";
  issueProjectStatusLocked: boolean;
  issueTodoProjectStatus: IssueProjectStatus | null;
  issueTodoProjectStatusAt: string | null;
  issueTodoProjectPriority: string | null;
  issueTodoProjectPriorityUpdatedAt: string | null;
  issueTodoProjectWeight: string | null;
  issueTodoProjectWeightUpdatedAt: string | null;
  issueTodoProjectInitiationOptions: string | null;
  issueTodoProjectInitiationOptionsUpdatedAt: string | null;
  issueTodoProjectStartDate: string | null;
  issueTodoProjectStartDateUpdatedAt: string | null;
  issueActivityStatus: IssueProjectStatus | null;
  issueActivityStatusAt: string | null;
  discussionAnsweredAt?: string | null;
  repository: ActivityRepository | null;
  author: ActivityUser | null;
  assignees: ActivityUser[];
  reviewers: ActivityUser[];
  mentionedUsers: ActivityUser[];
  commenters: ActivityUser[];
  reactors: ActivityUser[];
  labels: ActivityLabel[];
  issueType: ActivityIssueType | null;
  milestone: ActivityMilestone | null;
  linkedPullRequests: ActivityLinkedPullRequest[];
  linkedIssues: ActivityLinkedIssue[];
  hasParentIssue: boolean;
  hasSubIssues: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  mergedAt: string | null;
  businessDaysOpen?: number | null;
  businessDaysIdle?: number | null;
  businessDaysSinceInProgress?: number | null;
  businessDaysInProgressOpen?: number | null;
  reviewRequestWaits?: ActivityReviewRequestWait[];
  mentionWaits?: ActivityMentionWait[];
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
  generatedAt: string;
  timezone: string | null;
  dateTimeFormat: DateTimeDisplayFormat;
};

export type ActivityItemDetail = {
  item: ActivityItem;
  body: string | null;
  bodyHtml: string | null;
  raw: unknown;
  parentIssues: ActivityLinkedIssue[];
  subIssues: ActivityLinkedIssue[];
  comments: ActivityItemComment[];
  commentCount: number;
  linkedPullRequests: ActivityLinkedPullRequest[];
  linkedIssues: ActivityLinkedIssue[];
  reactions: ActivityReactionGroup[];
  todoStatusTimes?: Partial<Record<IssueProjectStatus, string | null>>;
  activityStatusTimes?: Partial<Record<IssueProjectStatus, string | null>>;
};

export type ActivityReactionGroup = {
  content: string | null;
  count: number;
  users: ActivityUser[];
};

export type ActivityFilterOptions = {
  repositories: ActivityRepository[];
  labels: ActivityLabel[];
  users: ActivityUser[];
  issueTypes: ActivityIssueType[];
  milestones: ActivityMilestone[];
  issuePriorities: ActivityIssuePriorityFilter[];
  issueWeights: ActivityIssueWeightFilter[];
};

export type ActivitySavedFilter = {
  id: string;
  name: string;
  payload: ActivityListParams;
  createdAt: string;
  updatedAt: string;
};
