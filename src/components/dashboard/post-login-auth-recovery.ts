"use client";

const POST_LOGIN_REFRESH_WAIT_MS = 100;

let pendingRefreshBarrier: Promise<void> | null = null;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function refreshAndWait(
  refresh: () => void,
  waitMs: number,
): Promise<void> {
  if (!pendingRefreshBarrier) {
    refresh();
    pendingRefreshBarrier = sleep(waitMs).finally(() => {
      pendingRefreshBarrier = null;
    });
  }

  await pendingRefreshBarrier;
}

export function isUnauthorizedResponse(response: Response) {
  return response.status === 401;
}

export async function retryOnceAfterUnauthorized<T>({
  execute,
  refresh,
  shouldRetry,
  waitMs = POST_LOGIN_REFRESH_WAIT_MS,
}: {
  execute: () => Promise<T>;
  refresh: () => void;
  shouldRetry: (result: T) => boolean;
  waitMs?: number;
}): Promise<T> {
  const firstResult = await execute();
  if (!shouldRetry(firstResult)) {
    return firstResult;
  }

  await refreshAndWait(refresh, waitMs);
  return execute();
}

export function __resetPostLoginAuthRecoveryForTests() {
  pendingRefreshBarrier = null;
}
