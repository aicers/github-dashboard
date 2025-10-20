import type {
  ActivityIssuePriorityFilter,
  ActivityIssueWeightFilter,
} from "@/lib/activity/types";

export const ISSUE_PRIORITY_VALUES: ActivityIssuePriorityFilter[] = [
  "P0",
  "P1",
  "P2",
];

export const ISSUE_WEIGHT_VALUES: ActivityIssueWeightFilter[] = [
  "Heavy",
  "Medium",
  "Light",
];
