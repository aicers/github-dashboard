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
  "inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary";

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

function formatPlaintextAsHtml(value: string) {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return "";
  }
  const escaped = escapeHtml(trimmed);
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, "<br />"));
  return paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");
}

export function resolveDetailBodyHtml(detail?: ActivityItemDetail | null) {
  if (!detail) {
    return null;
  }
  if (detail.bodyHtml?.trim()) {
    return sanitizeMarkdownHtml(detail.bodyHtml);
  }
  if (detail.body?.trim()) {
    return formatPlaintextAsHtml(detail.body);
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
]);

const SELF_CLOSING_HTML_TAGS = new Set(["br", "hr", "img"]);

const ALLOWED_HTML_ATTRS = new Map<string, Set<string>>([
  ["a", new Set(["href", "title"])],
  ["img", new Set(["src", "alt", "title"])],
]);

const GLOBAL_ALLOWED_HTML_ATTRS = new Set(["title"]);

function convertDomNodeToReact(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
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
    if (!src) {
      return null;
    }
    const alt = element.getAttribute("alt") ?? "";
    const title = element.getAttribute("title") ?? undefined;
    return createElement("img", {
      key,
      src,
      alt,
      title,
      loading: "lazy",
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

  const children = Array.from(element.childNodes).map((child, index) =>
    convertDomNodeToReact(child, `${key}-${index}`),
  );

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
