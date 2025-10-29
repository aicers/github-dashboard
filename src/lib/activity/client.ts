import type { ActivityItemDetail } from "./types";

type ActivityDetailFetchInit = {
  signal?: AbortSignal;
  useMentionAi?: boolean;
};

export async function fetchActivityDetail(
  id: string,
  init?: ActivityDetailFetchInit,
): Promise<ActivityItemDetail> {
  const trimmed = id.trim();
  if (!trimmed.length) {
    throw new Error("Activity id is required.");
  }

  const params = new URLSearchParams();
  if (init?.useMentionAi === false) {
    params.set("mentionAi", "0");
  }

  const query = params.toString();
  const url = query.length
    ? `/api/activity/${encodeURIComponent(trimmed)}?${query}`
    : `/api/activity/${encodeURIComponent(trimmed)}`;

  const response = await fetch(url, {
    signal: init?.signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch activity detail for ${trimmed}.`);
  }

  return (await response.json()) as ActivityItemDetail;
}
