const HOST = process.env.PLAYWRIGHT_TEST_HOST ?? "127.0.0.1";
const PORT = Number(process.env.PLAYWRIGHT_TEST_PORT ?? 3100);
const BASE_URL =
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? `http://${HOST}:${PORT}`;

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/`);
      if (response.ok || response.status >= 400) {
        return;
      }
    } catch (_error) {
      // swallow connection errors while retrying
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for dev server at ${BASE_URL} to become available.`,
  );
}

async function warmActivityCaches() {
  const response = await fetch(`${BASE_URL}/test-harness/cache/refresh`, {
    method: "POST",
  });
  if (!response.ok) {
    const status = response.status;
    const body = await response.text();
    throw new Error(
      `Failed to warm activity caches before tests (status ${status}): ${body}`,
    );
  }
}

export default async function globalSetup() {
  await waitForServer();
  await warmActivityCaches();
}
