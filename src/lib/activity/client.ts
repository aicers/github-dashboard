import type { ActivityItemDetail } from "./types";

export async function fetchActivityDetail(
  id: string,
  init?: { signal?: AbortSignal },
): Promise<ActivityItemDetail> {
  const trimmed = id.trim();
  if (!trimmed.length) {
    throw new Error("Activity id is required.");
  }

  const response = await fetch(`/api/activity/${encodeURIComponent(trimmed)}`, {
    signal: init?.signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch activity detail for ${trimmed}.`);
  }

  return (await response.json()) as ActivityItemDetail;
}
