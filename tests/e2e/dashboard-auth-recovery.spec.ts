import { buildSyncStatusFixture } from "@/components/test-harness/sync-fixtures";
import { expect, test } from "./harness/test";

test.describe("Dashboard auth recovery (Playwright)", () => {
  test.setTimeout(120_000);

  test("recovers the sync status panel after transient unauthorized responses", async ({
    page,
  }) => {
    await page.goto("/test-harness/auth/session?userId=e2e-user");

    let syncStatusRequestCount = 0;
    const now = new Date().toISOString();
    const syncStatus = buildSyncStatusFixture();
    const activeRun = syncStatus.runs[0];
    const runningLog = activeRun?.logs[0];

    if (!activeRun || !runningLog) {
      throw new Error("Expected sync status fixture to include a run and log");
    }

    syncStatus.runs = [
      {
        ...activeRun,
        status: "running",
        startedAt: now,
        completedAt: null,
        logs: [
          {
            ...runningLog,
            status: "running",
            message: "Processing issues",
            startedAt: now,
            finishedAt: null,
          },
        ],
      },
    ];
    syncStatus.logs = [
      {
        id: 1,
        resource: "issues",
        status: "running",
        message: "Processing issues",
        started_at: now,
        finished_at: null,
        run_id: activeRun.id,
      },
    ];

    await page.route("**/api/activity/filters**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ filters: [], limit: 5 }),
      });
    });

    await page.route("**/api/sync/status**", async (route) => {
      syncStatusRequestCount += 1;

      if (syncStatusRequestCount <= 2) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            message: "Authentication required.",
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          status: syncStatus,
        }),
      });
    });

    await page.goto("/dashboard/activity");

    await expect.poll(() => syncStatusRequestCount >= 3).toBe(true);
    await expect(page.getByText("Sync in progress")).toBeVisible();
    await expect(page.getByText("Authentication required.")).toHaveCount(0);
  });
});
