type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitGlobal = typeof globalThis & {
  __githubDashboardRateLimitStore?: Map<string, RateLimitBucket>;
};

type ConsumeRateLimitParams = {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function getRateLimitStore() {
  const globalRef = globalThis as RateLimitGlobal;
  if (!globalRef.__githubDashboardRateLimitStore) {
    globalRef.__githubDashboardRateLimitStore = new Map();
  }

  return globalRef.__githubDashboardRateLimitStore;
}

function cleanupExpiredEntries(now: number) {
  const store = getRateLimitStore();
  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function consumeRateLimit({
  scope,
  key,
  limit,
  windowMs,
  now = Date.now(),
}: ConsumeRateLimitParams): RateLimitResult {
  const store = getRateLimitStore();
  if (store.size >= 1_000) {
    cleanupExpiredEntries(now);
  }

  const bucketKey = `${scope}:${key}`;
  const existingBucket = store.get(bucketKey);
  if (!existingBucket || existingBucket.resetAt <= now) {
    store.set(bucketKey, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existingBucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existingBucket.resetAt - now) / 1000),
      ),
    };
  }

  existingBucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function createRetryAfterHeaders(retryAfterSeconds: number) {
  return {
    "Retry-After": String(retryAfterSeconds),
  };
}

export function resetRateLimitState() {
  getRateLimitStore().clear();
}
