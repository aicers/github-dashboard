"use client";

import { Button } from "@/components/ui/button";
import type {
  ActivityItem,
  ActivityItemDetail,
  ActivityMentionWait,
  IssueProjectStatus,
} from "@/lib/activity/types";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { cn } from "@/lib/utils";
import {
  ActivityCommentSection,
  formatDateOnly,
  formatDateTime,
  formatProjectField,
  ISSUE_STATUS_LABEL_MAP,
  ISSUE_STATUS_OPTIONS,
  MentionOverrideControls,
  ProjectFieldEditor,
  type ProjectFieldKey,
  ReactionSummaryList,
  renderMarkdownHtml,
  resolveDetailBodyHtml,
  SOURCE_STATUS_KEYS,
} from "../activity/detail-shared";
import {
  buildLinkedIssueSummary,
  buildLinkedPullRequestSummary,
} from "../activity/shared";

export function FollowUpDetailContent({
  item,
  detail,
  isLoading,
  timezone,
  dateTimeFormat,
  isUpdatingStatus,
  isUpdatingProjectFields,
  onUpdateStatus,
  onUpdateProjectField,
  canManageMentions = false,
  pendingMentionOverrideKey = null,
  onUpdateMentionOverride,
}: {
  item: ActivityItem;
  detail: ActivityItemDetail | undefined;
  isLoading: boolean;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  isUpdatingStatus: boolean;
  isUpdatingProjectFields: boolean;
  onUpdateStatus: (item: ActivityItem, status: IssueProjectStatus) => void;
  onUpdateProjectField: (
    item: ActivityItem,
    field: ProjectFieldKey,
    value: string | null,
  ) => Promise<boolean>;
  canManageMentions?: boolean;
  pendingMentionOverrideKey?: string | null;
  onUpdateMentionOverride?: (params: {
    itemId: string;
    commentId: string;
    mentionedUserId: string;
    state: "suppress" | "force" | "clear";
  }) => void;
}) {
  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground/80">
        내용을 불러오는 중입니다.
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="text-sm text-muted-foreground/80">
        선택한 항목의 내용을 불러오지 못했습니다.
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="text-sm text-muted-foreground/80">
        내용을 불러오는 중입니다.
      </div>
    );
  }

  const detailItem = detail.item ?? item;
  const currentIssueStatus = detailItem.issueProjectStatus ?? "no_status";
  const formatOptionalDateTime = (
    value: string | null | undefined,
  ): string | null => {
    if (!value) {
      return null;
    }

    return formatDateTime(value, timezone, dateTimeFormat);
  };
  const statusSourceLabel =
    detailItem.issueProjectStatusSource === "todo_project"
      ? "To-do 프로젝트"
      : detailItem.issueProjectStatusSource === "activity"
        ? "Activity"
        : "없음";
  const todoStatusLabel = detailItem.issueTodoProjectStatus
    ? (ISSUE_STATUS_LABEL_MAP.get(detailItem.issueTodoProjectStatus) ??
      detailItem.issueTodoProjectStatus)
    : "-";
  const todoPriorityLabel = formatProjectField(
    detailItem.issueTodoProjectPriority,
  );
  const todoWeightLabel = formatProjectField(detailItem.issueTodoProjectWeight);
  const todoWeightTimestamp = formatOptionalDateTime(
    detailItem.issueTodoProjectWeightUpdatedAt,
  );
  const todoInitiationLabel = formatProjectField(
    detailItem.issueTodoProjectInitiationOptions,
  );
  const todoInitiationTimestamp = formatOptionalDateTime(
    detailItem.issueTodoProjectInitiationOptionsUpdatedAt,
  );
  const todoStartDateLabel = formatDateOnly(
    detailItem.issueTodoProjectStartDate,
    timezone,
  );
  const todoStartDateTimestamp = formatOptionalDateTime(
    detailItem.issueTodoProjectStartDateUpdatedAt,
  );
  const canEditStatus =
    detailItem.type === "issue" && !detailItem.issueProjectStatusLocked;
  const sourceStatusTimes =
    detailItem.issueProjectStatusSource === "todo_project"
      ? (detail.todoStatusTimes ?? null)
      : detailItem.issueProjectStatusSource === "activity"
        ? (detail.activityStatusTimes ?? null)
        : null;
  const sourceStatusEntries = SOURCE_STATUS_KEYS.map((statusKey) => {
    const label = ISSUE_STATUS_LABEL_MAP.get(statusKey) ?? statusKey;
    const value = sourceStatusTimes?.[statusKey] ?? null;
    const formatted = formatOptionalDateTime(value) ?? "-";
    return { key: statusKey, label, value: formatted };
  });

  const renderedBody = resolveDetailBodyHtml(detail);
  const renderedContent = renderedBody
    ? renderMarkdownHtml(renderedBody)
    : null;
  const mentionWaits = detailItem.mentionWaits ?? [];
  const commentsList = detail.comments ?? [];
  const commentIdSet = new Set(
    commentsList
      .map((comment) => comment.id?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const mentionWaitsByCommentId = new Map<string, ActivityMentionWait[]>();
  const orphanMentionWaits: ActivityMentionWait[] = [];

  mentionWaits.forEach((wait) => {
    const commentKey = wait.id?.trim();
    if (commentKey && commentIdSet.has(commentKey)) {
      const current = mentionWaitsByCommentId.get(commentKey);
      if (current) {
        current.push(wait);
      } else {
        mentionWaitsByCommentId.set(commentKey, [wait]);
      }
      return;
    }
    orphanMentionWaits.push(wait);
  });

  const mentionControlsProps =
    mentionWaits.length > 0
      ? {
          byCommentId: Object.fromEntries(mentionWaitsByCommentId.entries()),
          canManageMentions,
          pendingOverrideKey: pendingMentionOverrideKey,
          onUpdateMentionOverride,
          detailItemId: detailItem.id,
        }
      : undefined;

  return (
    <div className="space-y-3 text-sm">
      {detailItem.type === "issue" && (
        <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground/70">
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground/60">Source:</span>
                <span className="text-foreground">{statusSourceLabel}</span>
              </span>
              {sourceStatusEntries.map(({ key, label, value }) => (
                <span
                  key={`${detailItem.id}-source-${key}`}
                  className="flex items-center gap-1"
                >
                  {label}:<span className="text-foreground">{value}</span>
                </span>
              ))}
              {detailItem.issueProjectStatusLocked && (
                <span className="text-amber-600">
                  To-do 프로젝트 상태({todoStatusLabel})로 잠겨 있어요.
                </span>
              )}
            </div>
            {(isUpdatingStatus || isUpdatingProjectFields) && (
              <span className="text-muted-foreground/70">업데이트 중...</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {ISSUE_STATUS_OPTIONS.map((option) => {
              const optionStatus = option.value as IssueProjectStatus;
              const active = currentIssueStatus === optionStatus;
              return (
                <Button
                  key={`status-action-${option.value}`}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  disabled={
                    isUpdatingStatus ||
                    isUpdatingProjectFields ||
                    !canEditStatus
                  }
                  onClick={() => onUpdateStatus(detailItem, optionStatus)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-muted-foreground/80">
            <ProjectFieldEditor
              item={detailItem}
              field="priority"
              label="Priority"
              rawValue={detailItem.issueTodoProjectPriority}
              formattedValue={todoPriorityLabel}
              timestamp={null}
              disabled={detailItem.issueProjectStatusLocked || isUpdatingStatus}
              isUpdating={isUpdatingProjectFields}
              onSubmit={onUpdateProjectField}
            />
            <ProjectFieldEditor
              item={detailItem}
              field="weight"
              label="Weight"
              rawValue={detailItem.issueTodoProjectWeight}
              formattedValue={todoWeightLabel}
              timestamp={todoWeightTimestamp}
              disabled={isUpdatingStatus}
              isUpdating={isUpdatingProjectFields}
              onSubmit={onUpdateProjectField}
            />
            <ProjectFieldEditor
              item={detailItem}
              field="initiationOptions"
              label="Initiation"
              rawValue={detailItem.issueTodoProjectInitiationOptions}
              formattedValue={todoInitiationLabel}
              timestamp={todoInitiationTimestamp}
              disabled={detailItem.issueProjectStatusLocked || isUpdatingStatus}
              isUpdating={isUpdatingProjectFields}
              onSubmit={onUpdateProjectField}
            />
            <ProjectFieldEditor
              item={detailItem}
              field="startDate"
              label="Start"
              rawValue={detailItem.issueTodoProjectStartDate}
              formattedValue={todoStartDateLabel}
              timestamp={todoStartDateTimestamp}
              disabled={detailItem.issueProjectStatusLocked || isUpdatingStatus}
              isUpdating={isUpdatingProjectFields}
              onSubmit={onUpdateProjectField}
            />
          </div>
          {!detailItem.issueProjectStatusLocked &&
            detailItem.issueProjectStatusSource !== "activity" && (
              <p className="mt-2 text-muted-foreground/80">
                Activity 상태는 To-do 프로젝트가 No Status 또는 Todo일 때만
                적용돼요.
              </p>
            )}
        </div>
      )}
      <div className="rounded-md border border-border bg-background px-4 py-3 text-sm">
        {(() => {
          if (!renderedBody) {
            return (
              <div className="text-muted-foreground/80">내용이 없습니다.</div>
            );
          }
          if (!renderedContent) {
            return (
              <div className="text-muted-foreground/80">
                내용을 표시할 수 없습니다.
              </div>
            );
          }
          return (
            <div className="space-y-4 leading-relaxed [&_a]:text-slate-700 [&_a]:underline-offset-2 [&_a:hover]:text-foreground [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_.user-mention]:font-semibold [&_.user-mention]:text-sky-700">
              {renderedContent}
            </div>
          );
        })()}
        <ReactionSummaryList reactions={detail.reactions} className="mt-3" />
      </div>
      {orphanMentionWaits.length > 0 && (
        <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
          <h4 className="text-sm font-semibold text-foreground">
            응답 없는 멘션
          </h4>
          <div className="mt-2 space-y-3">
            {orphanMentionWaits.map((wait, index) => {
              const mentionUserId = wait.user?.id ?? wait.userId ?? "";
              const mentionHandle =
                wait.user?.name ??
                (wait.user?.login ? `@${wait.user.login}` : mentionUserId);
              const aiStatus =
                wait.requiresResponse === false
                  ? "AI 판단: 응답 요구 아님"
                  : wait.requiresResponse === true
                    ? "AI 판단: 응답 필요"
                    : "AI 판단: 정보 없음";
              const aiStatusClass =
                wait.requiresResponse === false
                  ? "text-amber-600"
                  : "text-muted-foreground/70";
              const manualState =
                wait.manualRequiresResponse === false
                  ? "suppress"
                  : wait.manualRequiresResponse === true
                    ? "force"
                    : null;
              const manualTimestamp = formatOptionalDateTime(
                wait.manualRequiresResponseAt,
              );
              const mentionKey = `${wait.id}::${mentionUserId}`;
              const pendingOverride = pendingMentionOverrideKey === mentionKey;

              return (
                <div
                  key={`${wait.id}-${mentionUserId || index}`}
                  className="rounded-md border border-border/60 bg-background px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 text-foreground">
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold">
                        대상: {mentionHandle || "알 수 없음"}
                      </span>
                      <span className="text-muted-foreground/70">
                        언급일:{" "}
                        {formatOptionalDateTime(wait.mentionedAt) ?? "-"}
                      </span>
                    </div>
                    <span className={cn("text-xs font-medium", aiStatusClass)}>
                      {aiStatus}
                    </span>
                  </div>
                  {wait.manualDecisionIsStale && (
                    <p className="mt-1 text-[11px] text-amber-600">
                      최근 분류 이후 관리자 설정이 다시 필요합니다.
                    </p>
                  )}
                  {manualTimestamp && !wait.manualDecisionIsStale && (
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      관리자 설정: {manualTimestamp}
                    </p>
                  )}
                  {canManageMentions &&
                  onUpdateMentionOverride &&
                  mentionUserId ? (
                    <div className="mt-2">
                      <MentionOverrideControls
                        value={manualState}
                        pending={pendingOverride}
                        onChange={(next) => {
                          onUpdateMentionOverride({
                            itemId: detailItem.id,
                            commentId: wait.id,
                            mentionedUserId: mentionUserId,
                            state: next,
                          });
                        }}
                      />
                    </div>
                  ) : null}
                  {!mentionUserId && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      멘션된 사용자를 확인할 수 없어 관리자 설정을 적용할 수
                      없습니다.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <ActivityCommentSection
        comments={detail.comments}
        timezone={timezone}
        dateTimeFormat={dateTimeFormat}
        mentionControls={mentionControlsProps}
        commentContext={detailItem.type}
      />
      {detailItem.type === "issue" &&
      detailItem.linkedPullRequests.length > 0 ? (
        <div className="space-y-2 text-xs">
          <h4 className="font-semibold text-muted-foreground/85">연결된 PR</h4>
          <ul className="space-y-1">
            {detailItem.linkedPullRequests.map((linked) => {
              const summary = buildLinkedPullRequestSummary(linked);
              return (
                <li key={`follow-up-linked-pr-${linked.id}`}>
                  {linked.url ? (
                    <a
                      href={linked.url}
                      target="_blank"
                      rel="noreferrer"
                      className="reference-link"
                    >
                      {summary.label}
                    </a>
                  ) : (
                    <span>{summary.label}</span>
                  )}
                  {summary.status ? (
                    <span className="text-muted-foreground/70">
                      {` · ${summary.status}`}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {detailItem.type === "pull_request" &&
      detailItem.linkedIssues.length > 0 ? (
        <div className="space-y-2 text-xs">
          <h4 className="font-semibold text-muted-foreground/85">
            연결된 이슈
          </h4>
          <ul className="space-y-1">
            {detailItem.linkedIssues.map((linked) => {
              const summary = buildLinkedIssueSummary(linked);
              return (
                <li key={`follow-up-linked-issue-${linked.id}`}>
                  {linked.url ? (
                    <a
                      href={linked.url}
                      target="_blank"
                      rel="noreferrer"
                      className="reference-link"
                    >
                      {summary.label}
                    </a>
                  ) : (
                    <span>{summary.label}</span>
                  )}
                  {summary.status ? (
                    <span className="text-muted-foreground/70">
                      {` · ${summary.status}`}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {(detail.parentIssues.length > 0 || detail.subIssues.length > 0) && (
        <div className="space-y-4 text-xs">
          {detail.parentIssues.length > 0 && (
            <div>
              <h4 className="font-semibold text-muted-foreground/85">
                상위 이슈
              </h4>
              <ul className="mt-1 space-y-1">
                {detail.parentIssues.map((linked) => {
                  const referenceParts: string[] = [];
                  if (linked.repositoryNameWithOwner) {
                    referenceParts.push(linked.repositoryNameWithOwner);
                  }
                  if (typeof linked.number === "number") {
                    referenceParts.push(`#${linked.number}`);
                  }
                  const referenceLabel =
                    referenceParts.length > 0 ? referenceParts.join("") : null;
                  const titleLabel = linked.title ?? linked.state ?? linked.id;
                  const displayLabel = referenceLabel
                    ? `${referenceLabel}${titleLabel ? ` — ${titleLabel}` : ""}`
                    : titleLabel;
                  return (
                    <li key={`parent-${linked.id}`}>
                      {linked.url ? (
                        <a
                          href={linked.url}
                          target="_blank"
                          rel="noreferrer"
                          className="reference-link"
                        >
                          {displayLabel ?? linked.id}
                        </a>
                      ) : (
                        <span>{displayLabel ?? linked.id}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {detail.subIssues.length > 0 && (
            <div>
              <h4 className="font-semibold text-muted-foreground/85">
                하위 이슈
              </h4>
              <ul className="mt-1 space-y-1">
                {detail.subIssues.map((linked) => {
                  const referenceParts: string[] = [];
                  if (linked.repositoryNameWithOwner) {
                    referenceParts.push(linked.repositoryNameWithOwner);
                  }
                  if (typeof linked.number === "number") {
                    referenceParts.push(`#${linked.number}`);
                  }
                  const referenceLabel =
                    referenceParts.length > 0 ? referenceParts.join("") : null;
                  const titleLabel = linked.title ?? linked.state ?? linked.id;
                  const displayLabel = referenceLabel
                    ? `${referenceLabel}${titleLabel ? ` — ${titleLabel}` : ""}`
                    : titleLabel;
                  return (
                    <li key={`sub-${linked.id}`}>
                      {linked.url ? (
                        <a
                          href={linked.url}
                          target="_blank"
                          rel="noreferrer"
                          className="reference-link"
                        >
                          {displayLabel ?? linked.id}
                        </a>
                      ) : (
                        <span>{displayLabel ?? linked.id}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
