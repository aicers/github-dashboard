import { vi } from "vitest";

type FetchMockHandler = (
  request: Request,
  signal: AbortSignal | undefined,
) => Response | Promise<Response>;

type MockFetchResponseConfig = {
  status?: number;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  json?: unknown;
  text?: string;
  delayMs?: number;
};

type MockFetchDescriptor =
  | FetchMockHandler
  | Response
  | MockFetchResponseConfig;

const originalFetch = global.fetch;
const handlerQueue: FetchMockHandler[] = [];
const mockMarker = Symbol("mockFetch");
const MOCK_FETCH_BASE_URL = "https://vitest.mock";

const fetchNotHandled: FetchMockHandler = (request) => {
  throw new Error(
    `No fetch mock registered for ${request.method ?? "GET"} ${request.url}`,
  );
};

let defaultHandler: FetchMockHandler = fetchNotHandled;

export const fetchMock = vi.fn<(request: Request) => void>();

function toAbortError(reason?: unknown): DOMException {
  if (reason instanceof DOMException && reason.name === "AbortError") {
    return reason;
  }
  const message =
    typeof reason === "string" && reason.length > 0
      ? reason
      : "The operation was aborted.";
  return new DOMException(message, "AbortError");
}

function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!delayMs || delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timerId = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timerId);
      cleanup();
      reject(toAbortError(signal?.reason));
    };

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function normalizeHandler(descriptor: MockFetchDescriptor): FetchMockHandler {
  if (typeof descriptor === "function") {
    return descriptor;
  }

  if (descriptor instanceof Response) {
    return () => descriptor.clone();
  }

  const config = descriptor;

  return async (_request, signal) => {
    if (config.delayMs) {
      await waitForDelay(config.delayMs, signal);
    }

    if (signal?.aborted) {
      throw toAbortError(signal.reason);
    }

    if (config.json !== undefined) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...config.headers,
      };
      return new Response(JSON.stringify(config.json), {
        status: config.status ?? 200,
        headers,
      });
    }

    if (config.text !== undefined) {
      return new Response(config.text, {
        status: config.status ?? 200,
        headers: config.headers,
      });
    }

    return new Response(config.body ?? null, {
      status: config.status ?? 200,
      headers: config.headers,
    });
  };
}

function dequeueHandler(): FetchMockHandler {
  return handlerQueue.shift() ?? defaultHandler;
}

function executeHandler(
  handler: FetchMockHandler,
  request: Request,
  signal?: AbortSignal,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let done = false;

    const finish = (callback: () => void) => {
      if (done) {
        return;
      }
      done = true;
      if (signal) {
        signal.removeEventListener("abort", abortListener);
      }
      callback();
    };

    const abortListener = () => {
      finish(() => {
        reject(toAbortError(signal?.reason));
      });
    };

    if (signal) {
      if (signal.aborted) {
        abortListener();
        return;
      }
      signal.addEventListener("abort", abortListener, { once: true });
    }

    Promise.resolve(handler(request, signal))
      .then((response) => {
        finish(() => resolve(response));
      })
      .catch((error) => {
        finish(() => reject(error));
      });
  });
}

function createMockFetch(): typeof fetch {
  const mockFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let request: Request;
    if (input instanceof Request) {
      request = init ? new Request(input, init) : input;
    } else if (input instanceof URL) {
      request = new Request(input.toString(), init);
    } else if (typeof input === "string") {
      const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(input);
      const urlString = hasProtocol
        ? input
        : new URL(input, MOCK_FETCH_BASE_URL).toString();
      request = new Request(urlString, init);
    } else {
      request = new Request(input, init);
    }
    const signal = init?.signal ?? request.signal;

    fetchMock(request);

    const handler = dequeueHandler();
    return executeHandler(handler, request, signal);
  }) as typeof fetch;

  // @ts-expect-error - marker to avoid double installation.
  mockFetch[mockMarker] = true;
  return mockFetch;
}

export function installMockFetch() {
  const current = global.fetch as typeof fetch & {
    [mockMarker]?: boolean;
  };
  if (current?.[mockMarker]) {
    return;
  }
  global.fetch = createMockFetch();
}

export function restoreMockFetch() {
  if (global.fetch !== originalFetch) {
    global.fetch = originalFetch;
  }
  resetMockFetch();
}

export function resetMockFetch() {
  handlerQueue.length = 0;
  defaultHandler = fetchNotHandled;
  fetchMock.mockReset();
}

export function mockFetchOnce(descriptor: MockFetchDescriptor) {
  handlerQueue.push(normalizeHandler(descriptor));
}

export function mockFetchMany(descriptor: MockFetchDescriptor, count: number) {
  if (count <= 0) {
    return;
  }
  const handler = normalizeHandler(descriptor);
  for (let index = 0; index < count; index += 1) {
    handlerQueue.push(handler);
  }
}

export function setDefaultFetchHandler(descriptor: MockFetchDescriptor | null) {
  defaultHandler = descriptor ? normalizeHandler(descriptor) : fetchNotHandled;
}

export function createJsonResponse(
  data: unknown,
  init?: ResponseInit,
): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export function mockFetchJsonOnce(
  data: unknown,
  init?: Omit<MockFetchResponseConfig, "json">,
) {
  mockFetchOnce({
    ...init,
    json: data,
  });
}

export function mockFetchErrorOnce(
  status: number,
  data?: unknown,
  init?: Omit<MockFetchResponseConfig, "json" | "status">,
) {
  if (data === undefined) {
    mockFetchOnce({
      status,
      body: null,
      ...init,
    });
    return;
  }

  mockFetchOnce({
    status,
    json: data,
    ...init,
  });
}
