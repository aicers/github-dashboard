import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetPostLoginAuthRecoveryForTests,
  isUnauthorizedResponse,
  retryOnceAfterUnauthorized,
} from "@/components/dashboard/post-login-auth-recovery";

describe("post-login auth recovery", () => {
  beforeEach(() => {
    __resetPostLoginAuthRecoveryForTests();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    __resetPostLoginAuthRecoveryForTests();
  });

  it("refreshes and retries once after the first unauthorized response", async () => {
    const refresh = vi.fn();
    const execute = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const pending = retryOnceAfterUnauthorized({
      execute,
      refresh,
      shouldRetry: isUnauthorizedResponse,
    });

    await vi.advanceTimersByTimeAsync(100);
    const response = await pending;

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it("coalesces concurrent refreshes while multiple requests recover", async () => {
    const refresh = vi.fn();
    const firstExecute = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const secondExecute = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const firstPending = retryOnceAfterUnauthorized({
      execute: firstExecute,
      refresh,
      shouldRetry: isUnauthorizedResponse,
    });
    const secondPending = retryOnceAfterUnauthorized({
      execute: secondExecute,
      refresh,
      shouldRetry: isUnauthorizedResponse,
    });

    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([firstPending, secondPending]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(firstExecute).toHaveBeenCalledTimes(2);
    expect(secondExecute).toHaveBeenCalledTimes(2);
  });
});
