"use client";

import { DateTime } from "luxon";
import {
  type ChangeEvent,
  createElement,
  type FormEvent,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import type {
  ActivityItem,
  ActivityItemComment,
  ActivityItemDetail,
  ActivityStatusFilter,
  IssueProjectStatus,
} from "@/lib/activity/types";
import {
  type DateTimeDisplayFormat,
  formatDateTimeDisplay,
} from "@/lib/date-time-format";

export type ProjectFieldKey =
  | "priority"
  | "weight"
  | "initiationOptions"
  | "startDate";

export const PROJECT_FIELD_LABELS: Record<ProjectFieldKey, string> = {
  priority: "Priority",
  weight: "Weight",
  initiationOptions: "Initiation",
  startDate: "Start date",
};

export const PROJECT_FIELD_BADGE_CLASS =
  "inline-flex items-center rounded-md bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700";

const PRIORITY_OPTIONS = ["P0", "P1", "P2"] as const;
const WEIGHT_OPTIONS = ["Heavy", "Medium", "Light"] as const;
const INITIATION_OPTIONS = ["Open to Start", "Requires Approval"] as const;

export const ISSUE_STATUS_OPTIONS: Array<{
  value: ActivityStatusFilter;
  label: string;
}> = [
  { value: "no_status", label: "No Status" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "pending", label: "Pending" },
];

export const ISSUE_STATUS_LABEL_MAP = new Map(
  ISSUE_STATUS_OPTIONS.map((option) => [option.value, option.label]),
);

export const ISSUE_STATUS_VALUE_SET = new Set<ActivityStatusFilter>(
  ISSUE_STATUS_OPTIONS.map((option) => option.value),
);

export const SOURCE_STATUS_KEYS: IssueProjectStatus[] = [
  "todo",
  "in_progress",
  "done",
];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeMarkdownHtml(value: string) {
  return value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s+(href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|\s*javascript:[^\s>]*)/gi,
      "",
    )
    .replace(/<(iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, "");
}

function sanitizeLanguageTag(value: string) {
  return value
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^A-Za-z0-9_-]/g, "")
    .toLowerCase();
}

export function formatPlaintextAsHtml(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized.length) {
    return "";
  }
  const lines = normalized.split("\n");
  const htmlParts: string[] = [];
  let paragraphBuffer: string[] = [];
  let inCodeFence = false;
  let fenceLanguage: string | null = null;
  let codeBuffer: string[] = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) {
      return;
    }
    const paragraphText = paragraphBuffer.join("\n");
    paragraphBuffer = [];
    const placeholders: string[] = [];
    let textWithPlaceholders = paragraphText.replace(
      /`([^`\n]+)`/g,
      (_match, code) => {
        const placeholder = `@@CODE_PLACEHOLDER_${placeholders.length}@@`;
        placeholders.push(`<code>${escapeHtml(code)}</code>`);
        return placeholder;
      },
    );
    textWithPlaceholders = escapeHtml(textWithPlaceholders);
    const highlighted = textWithPlaceholders.replace(
      /(^|[\s(])(@[A-Za-z0-9][A-Za-z0-9-]*)/g,
      (_, prefix: string, mention: string) =>
        `${prefix}<span class="user-mention">${mention}</span>`,
    );
    const restored = highlighted.replace(
      /@@CODE_PLACEHOLDER_(\d+)@@/g,
      (_match, index) => placeholders[Number.parseInt(index, 10)] ?? "",
    );
    const paragraph = restored.replace(/\n/g, "<br />");
    if (paragraph.trim().length) {
      htmlParts.push(`<p>${paragraph}</p>`);
    }
  };

  const flushCodeBlock = () => {
    const codeContent = codeBuffer.join("\n");
    codeBuffer = [];
    const escapedCode = escapeHtml(codeContent);
    const language = fenceLanguage ? sanitizeLanguageTag(fenceLanguage) : null;
    const classAttr = language ? ` class="language-${language}"` : "";
    htmlParts.push(`<pre><code${classAttr}>${escapedCode}</code></pre>`);
    fenceLanguage = null;
  };

  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^```(.*)$/);
    if (fenceMatch) {
      if (inCodeFence) {
        flushCodeBlock();
        inCodeFence = false;
      } else {
        flushParagraph();
        inCodeFence = true;
        fenceLanguage = fenceMatch[1] ?? null;
      }
      return;
    }

    if (inCodeFence) {
      codeBuffer.push(line);
      return;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      return;
    }

    paragraphBuffer.push(line);

    const isLastLine = index === lines.length - 1;
    if (isLastLine) {
      flushParagraph();
    }
  });

  if (inCodeFence) {
    flushCodeBlock();
  }

  return htmlParts.join("");
}

export function resolveDetailBodyHtml(detail?: ActivityItemDetail | null) {
  if (!detail) {
    return null;
  }
  if (detail.bodyHtml?.trim()) {
    return sanitizeMarkdownHtml(detail.bodyHtml);
  }
  if (detail.body?.trim()) {
    if (/<\s*img\b/i.test(detail.body)) {
      return sanitizeMarkdownHtml(detail.body);
    }
    return formatPlaintextAsHtml(detail.body);
  }
  return null;
}

function resolveCommentBodyHtml(comment: ActivityItemComment) {
  if (comment.bodyHtml?.trim()) {
    return sanitizeMarkdownHtml(comment.bodyHtml);
  }

  if (comment.body?.trim()) {
    if (/<\s*img\b/i.test(comment.body)) {
      return sanitizeMarkdownHtml(comment.body);
    }
    return formatPlaintextAsHtml(comment.body);
  }

  return null;
}

const ALLOWED_HTML_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "span",
]);

const SELF_CLOSING_HTML_TAGS = new Set(["br", "hr", "img"]);

const ALLOWED_HTML_ATTRS = new Map<string, Set<string>>([
  ["a", new Set(["href", "title"])],
  ["img", new Set(["src", "alt", "title"])],
]);

const GLOBAL_ALLOWED_HTML_ATTRS = new Set(["title"]);

const MEDIA_TOKEN_REGEX =
  /\b([A-Za-z0-9][\w.-]*\.(?:mov|mp4|m4v|avi|wmv|mkv|webm))\b/gi;

const MEDIA_PLACEHOLDER_CLASS =
  "inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground/90";

const ATTACHMENT_PLACEHOLDER_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-dashed border-border/70 bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground/90";

function extractFileName(href: string | null | undefined) {
  if (!href) {
    return null;
  }
  try {
    const url = new URL(href);
    const pathname = url.pathname.replace(/\/+$/, "");
    const segments = pathname.split("/");
    const candidate = segments.at(-1);
    return candidate?.trim() ? candidate : null;
  } catch {
    const sanitized = href.split(/[?#]/)[0];
    const segments = sanitized.split("/");
    const candidate = segments.at(-1);
    return candidate?.trim() ? candidate : null;
  }
}

function createAttachmentPlaceholder(
  key: string,
  kind: "image" | "file",
  options: {
    alt?: string | null;
    title?: string | null;
    href?: string | null;
  },
) {
  const icon = kind === "image" ? "🖼️" : "📎";
  const labelParts: string[] = [];
  labelParts.push(kind === "image" ? "이미지 첨부" : "파일 첨부");

  const alt = options.alt?.trim();
  const title = options.title?.trim();
  const fileName = extractFileName(options.href);

  if (alt) {
    labelParts.push(alt);
  } else if (title) {
    labelParts.push(title);
  }

  if (fileName && fileName !== alt && fileName !== title) {
    labelParts.push(fileName);
  }

  const label = labelParts.join(" · ");
  return createElement(
    "span",
    {
      key,
      role: "img",
      "aria-label": label,
      className: ATTACHMENT_PLACEHOLDER_CLASS,
    },
    `${icon} ${label}`,
  );
}

function isImageLink(href: string) {
  try {
    const url = new URL(href);
    const path = url.pathname.toLowerCase();
    return (
      path.endsWith(".png") ||
      path.endsWith(".jpg") ||
      path.endsWith(".jpeg") ||
      path.endsWith(".gif") ||
      path.endsWith(".webp") ||
      path.endsWith(".avif") ||
      path.endsWith(".svg")
    );
  } catch {
    return false;
  }
}

function shouldShortenLinkLabel(element: HTMLElement, href: string | null) {
  if (!href) {
    return false;
  }

  const text = element.textContent?.trim();
  if (!text) {
    return false;
  }

  const normalize = (value: string) =>
    value
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "");

  return normalize(text) === normalize(href);
}

function formatLinkLabel(href: string) {
  try {
    const url = new URL(href);
    let label = url.host;
    const path = url.pathname.replace(/\/$/, "");
    if (path && path !== "/") {
      const condensed = path.length > 20 ? `${path.slice(0, 20)}…` : path;
      label += condensed;
    }
    if (url.search) {
      label += "…";
    }
    return label;
  } catch {
    return href;
  }
}

function renderMediaTokenReact(text: string, key: string): ReactNode {
  MEDIA_TOKEN_REGEX.lastIndex = 0;
  const matches = Array.from(text.matchAll(MEDIA_TOKEN_REGEX));
  if (!matches.length) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  matches.forEach((match, index) => {
    const fullMatch = match[0];
    const token = match[1] ?? fullMatch;
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    nodes.push(
      createElement(
        "span",
        {
          key: `${key}-media-${index}`,
          className: MEDIA_PLACEHOLDER_CLASS,
        },
        `🎥 ${token}`,
      ),
    );
    lastIndex = start + fullMatch.length;
  });

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  if (nodes.length === 1) {
    return nodes[0];
  }

  return createElement(Fragment, { key: `${key}-media-fragment` }, ...nodes);
}

function convertDomNodeToReact(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return renderMediaTokenReact(node.textContent ?? "", key);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();

  if (!ALLOWED_HTML_TAGS.has(tagName)) {
    return Array.from(element.childNodes).map((child, index) =>
      convertDomNodeToReact(child, `${key}-${index}`),
    );
  }

  if (tagName === "img") {
    const src = element.getAttribute("src");
    return createAttachmentPlaceholder(key, "image", {
      href: src,
      alt: element.getAttribute("alt"),
      title: element.getAttribute("title"),
    });
  }

  const props: Record<string, unknown> = { key };
  const allowedAttrs = ALLOWED_HTML_ATTRS.get(tagName);

  element.getAttributeNames().forEach((attrName) => {
    const value = element.getAttribute(attrName);
    if (value === null) {
      return;
    }

    if (attrName === "class") {
      props.className = value;
      return;
    }

    if (allowedAttrs) {
      if (!allowedAttrs.has(attrName)) {
        return;
      }
    } else if (!GLOBAL_ALLOWED_HTML_ATTRS.has(attrName)) {
      return;
    }

    if (attrName === "href") {
      props.href = value;
      if (!value.startsWith("#")) {
        props.target = "_blank";
        props.rel = "noreferrer";
      }
      return;
    }

    props[attrName] = value;
  });

  let children = Array.from(element.childNodes).map((child, index) =>
    convertDomNodeToReact(child, `${key}-${index}`),
  );

  if (tagName === "a") {
    const href = element.getAttribute("href");
    if (href) {
      props.title ??= href;
      if (shouldShortenLinkLabel(element, href)) {
        if (isImageLink(href)) {
          children = [
            createAttachmentPlaceholder(`${key}-img`, "image", {
              href,
              title: element.getAttribute("title"),
            }),
          ];
        } else {
          children = [formatLinkLabel(href)];
        }
      }
    }
  }

  if (SELF_CLOSING_HTML_TAGS.has(tagName)) {
    return createElement(tagName, props);
  }

  return createElement(tagName, props, ...children);
}

export function renderMarkdownHtml(html: string | null): ReactNode {
  if (!html) {
    return null;
  }

  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const nodes = Array.from(doc.body.childNodes).map((child, index) =>
    convertDomNodeToReact(child, `md-${index}`),
  );
  return createElement(Fragment, null, ...nodes);
}

export function formatDateTime(
  value: string | null,
  timeZone?: string | null,
  displayFormat?: DateTimeDisplayFormat | null,
) {
  if (!value) {
    return "-";
  }

  const trimmedZone = timeZone?.trim();
  const formatted = formatDateTimeDisplay(value, {
    timeZone: trimmedZone,
    format: displayFormat ?? undefined,
  });

  if (formatted) {
    return formatted;
  }

  return value;
}

export function formatDateOnly(value: string | null, timeZone?: string | null) {
  if (!value) {
    return "-";
  }

  const trimmed = value.trim();
  if (!trimmed.length) {
    return "-";
  }

  try {
    let date = DateTime.fromISO(trimmed);
    if (!date.isValid) {
      return trimmed;
    }

    const zone = timeZone?.trim();
    if (zone?.length) {
      date = date.setZone(zone);
    }

    return date.toLocaleString(DateTime.DATE_MED);
  } catch {
    return trimmed;
  }
}

export function formatProjectField(value: string | null) {
  if (!value) {
    return "-";
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : "-";
}

export function ActivityCommentSection({
  comments,
  timezone,
  dateTimeFormat,
}: {
  comments?: ActivityItemComment[] | null;
  timezone?: string | null;
  dateTimeFormat?: DateTimeDisplayFormat | null;
}) {
  const list = comments ?? [];
  const hasComments = list.length > 0;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground/85">
        댓글 ({list.length})
      </h4>
      {hasComments ? (
        <div className="space-y-3">
          {list.map((comment) => {
            const createdLabel = formatDateTime(
              comment.createdAt,
              timezone,
              dateTimeFormat,
            );
            const updatedLabel = formatDateTime(
              comment.updatedAt,
              timezone,
              dateTimeFormat,
            );
            const isEdited = Boolean(
              comment.updatedAt &&
                comment.createdAt &&
                comment.updatedAt !== comment.createdAt,
            );
            const displayTimestamp = updatedLabel ?? createdLabel ?? "-";
            const timestampTitle = isEdited
              ? `작성: ${createdLabel ?? "-"}
수정: ${updatedLabel ?? "-"}`
              : (createdLabel ?? updatedLabel ?? "-");

            const authorLabel =
              comment.author?.login ??
              comment.author?.name ??
              comment.author?.id ??
              "알 수 없음";

            const badges: string[] = [];
            if (comment.reviewId) {
              badges.push("리뷰 댓글");
            }
            if (comment.replyToId) {
              badges.push("답글");
            }

            const renderedBody = resolveCommentBodyHtml(comment);
            const content = renderedBody
              ? renderMarkdownHtml(renderedBody)
              : null;

            return (
              <article
                key={comment.id}
                className="rounded-md border border-border bg-background px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground/70">
                  <span className="font-semibold text-foreground">
                    {authorLabel}
                  </span>
                  <span title={timestampTitle} className="text-right">
                    {displayTimestamp}
                    {isEdited ? (
                      <span className="ml-1 text-[0.7rem] text-muted-foreground/70">
                        (수정됨)
                      </span>
                    ) : null}
                  </span>
                </div>
                {badges.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-[0.7rem] text-amber-600">
                    {badges.map((badge) => (
                      <span
                        key={`${comment.id}-${badge}`}
                        className="rounded-full bg-amber-100 px-2 py-0.5"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                ) : null}
                {content ? (
                  <div className="mt-2 space-y-4 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline-offset-2 [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_.user-mention]:font-semibold">
                    {content}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-muted-foreground/80">
                    내용을 표시할 수 없습니다.
                  </div>
                )}
                {comment.url ? (
                  <a
                    href={comment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex text-xs font-medium text-primary hover:underline"
                  >
                    GitHub에서 보기
                  </a>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-background px-4 py-3 text-sm text-muted-foreground/80">
          댓글이 없습니다.
        </div>
      )}
    </div>
  );
}

function normalizeProjectFieldValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function normalizeProjectFieldForComparison(
  field: ProjectFieldKey,
  value: string | null | undefined,
) {
  const normalized = normalizeProjectFieldValue(value);
  if (!normalized) {
    return null;
  }

  if (field === "startDate") {
    const parsed = DateTime.fromISO(normalized);
    if (parsed.isValid) {
      return parsed.toISODate();
    }
  }

  if (field === "priority") {
    return normalized.toUpperCase();
  }

  if (field === "weight") {
    return normalized.toLowerCase();
  }

  return normalized;
}

export function toProjectFieldInputValue(
  field: ProjectFieldKey,
  value: string | null,
) {
  if (!value) {
    return "";
  }

  if (field === "startDate") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    if (value.length >= 10) {
      return value.slice(0, 10);
    }
  }

  return value;
}

export function normalizeProjectFieldDraft(
  field: ProjectFieldKey,
  draft: string,
) {
  const trimmed = draft.trim();
  if (!trimmed.length) {
    return null;
  }

  if (field === "priority") {
    return trimmed.toUpperCase();
  }

  if (field === "weight") {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }

  if (field === "startDate") {
    return trimmed;
  }

  return trimmed;
}

type ProjectFieldEditorProps = {
  item: ActivityItem;
  field: ProjectFieldKey;
  label: string;
  rawValue: string | null;
  formattedValue: string;
  timestamp: string | null;
  disabled: boolean;
  isUpdating: boolean;
  onSubmit: (
    item: ActivityItem,
    field: ProjectFieldKey,
    value: string | null,
  ) => Promise<boolean>;
};

export function ProjectFieldEditor({
  item,
  field,
  label,
  rawValue,
  formattedValue,
  timestamp,
  disabled,
  isUpdating,
  onSubmit,
}: ProjectFieldEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() =>
    toProjectFieldInputValue(field, rawValue),
  );
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const handleInputRef = useCallback(
    (element: HTMLInputElement | HTMLSelectElement | null) => {
      inputRef.current = element;
    },
    [],
  );
  const isSelect =
    field === "priority" || field === "weight" || field === "initiationOptions";
  const selectOptions =
    field === "priority"
      ? PRIORITY_OPTIONS
      : field === "weight"
        ? WEIGHT_OPTIONS
        : field === "initiationOptions"
          ? INITIATION_OPTIONS
          : null;

  useEffect(() => {
    if (!isEditing) {
      setDraft(toProjectFieldInputValue(field, rawValue));
    }
  }, [field, rawValue, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    if (isSelect && selectOptions) {
      if (!rawValue && selectOptions.length > 0 && draft.trim().length === 0) {
        setDraft(selectOptions[0]);
      }
      return;
    }

    if (field === "startDate" && draft.trim().length === 0) {
      const today = DateTime.local().toISODate();
      if (today) {
        setDraft(today);
      }
    }
  }, [draft, field, isEditing, isSelect, rawValue, selectOptions]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const normalizedDraft = normalizeProjectFieldDraft(field, draft);
  const hasChanges =
    normalizeProjectFieldForComparison(field, rawValue) !==
    normalizeProjectFieldForComparison(field, normalizedDraft);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasChanges) {
      setIsEditing(false);
      return;
    }

    const success = await onSubmit(item, field, normalizedDraft);
    if (success) {
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setDraft(toProjectFieldInputValue(field, rawValue));
    setIsEditing(false);
  };

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setDraft(event.target.value);
  };

  const showEditButton = !disabled && !isEditing;
  const displayValue = formattedValue.trim().length ? formattedValue : "-";

  return (
    <div className="flex items-center gap-2 text-xs text-foreground">
      <span className="font-semibold text-foreground">{label}:</span>
      {isEditing ? (
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-center gap-2"
        >
          {isSelect && selectOptions ? (
            <select
              value={draft}
              onChange={handleChange}
              disabled={isUpdating}
              className="h-7 rounded border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              ref={handleInputRef}
            >
              {selectOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="date"
              value={draft}
              disabled={isUpdating}
              onChange={handleChange}
              className="h-7 rounded border border-border bg-background px-1.5 text-[11px] text-foreground focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              ref={handleInputRef}
            />
          )}
          <div className="flex items-center gap-1">
            <Button
              type="submit"
              size="sm"
              disabled={!hasChanges || isUpdating}
              className="h-7 px-2 text-[11px]"
            >
              저장
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={isUpdating}
              className="h-7 px-2 text-[11px]"
            >
              취소
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{displayValue}</span>
          {timestamp ? (
            <span className="text-muted-foreground/70">{timestamp}</span>
          ) : null}
          {showEditButton && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(true)}
              disabled={isUpdating}
              className="h-7 px-2 text-[11px]"
            >
              수정
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
