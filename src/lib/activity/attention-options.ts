import type { ActivityAttentionFilter } from "@/lib/activity/types";

export type AttentionOption = {
  value: ActivityAttentionFilter;
  label: string;
};

export const ATTENTION_OPTIONS: ReadonlyArray<AttentionOption> = [
  { value: "no_attention", label: "주의 없음" },
  { value: "issue_backlog", label: "정체된 Backlog 이슈" },
  { value: "issue_stalled", label: "정체된 In Progress 이슈" },
  { value: "pr_inactive", label: "업데이트 없는 PR" },
  { value: "review_requests_pending", label: "응답 없는 리뷰 요청" },
  { value: "unanswered_mentions", label: "응답 없는 멘션" },
] as const;

export const ATTENTION_REQUIRED_VALUES: ActivityAttentionFilter[] =
  ATTENTION_OPTIONS.filter((option) => option.value !== "no_attention").map(
    (option) => option.value,
  );
