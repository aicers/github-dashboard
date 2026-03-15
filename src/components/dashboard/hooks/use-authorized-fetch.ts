"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  isUnauthorizedResponse,
  retryOnceAfterUnauthorized,
} from "@/components/dashboard/post-login-auth-recovery";

/**
 * Returns a function that wraps a fetch call with automatic retry on 401
 * responses. On the first 401, `router.refresh()` is called to refresh
 * the server session, and the fetch is retried once.
 */
export function useAuthorizedFetch() {
  const router = useRouter();
  return useCallback(
    (execute: () => Promise<Response>) =>
      retryOnceAfterUnauthorized({
        execute,
        refresh: () => {
          router.refresh();
        },
        shouldRetry: isUnauthorizedResponse,
      }),
    [router],
  );
}
