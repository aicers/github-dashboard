import { expect, test } from "@playwright/test";

import { buildDashboardAnalyticsFixture } from "@/components/test-harness/dashboard-fixtures";

const ANALYTICS_PATH = "/test-harness/analytics";

test.describe("AnalyticsView (Playwright)", () => {
  test("applies filters and refreshes analytics data", async ({ page }) => {
    await page.route("**/api/dashboard/analytics**", async (route) => {
      const analytics = buildDashboardAnalyticsFixture();
      const prsCreated = analytics.organization.metrics.prsCreated;
      prsCreated.previous = 4000;
      prsCreated.current = 4321;
      prsCreated.absoluteChange = prsCreated.current - prsCreated.previous;
      prsCreated.percentChange =
        prsCreated.previous === 0
          ? null
          : prsCreated.absoluteChange / prsCreated.previous;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, analytics }),
      });
    });

    await page.goto(ANALYTICS_PATH);

    await page.getByRole("button", { name: "최근 30일" }).click();
    await page.getByRole("button", { name: "사용자 지정" }).click();
    await page.getByLabel("시작일").fill("2024-02-01");
    await page.getByLabel("종료일").fill("2024-02-10");

    const repoSelect = page.locator("select[multiple]");
    await repoSelect.selectOption(["repo-2"]);

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/dashboard/analytics") &&
        response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "필터 적용" }).click();
    const response = await responsePromise;

    const url = new URL(response.url());
    expect(url.searchParams.get("repos")).toBe("repo-2");
    expect(url.searchParams.has("person")).toBe(false);
    expect(url.searchParams.get("start")).toContain("2024-02-01");
    expect(url.searchParams.get("end")).toContain("2024-02-10");
  });

  test("switches average PR size mode and sorts repository metrics", async ({
    page,
  }) => {
    await page.goto(ANALYTICS_PATH);

    const additionsButton = page
      .locator('button[data-slot="button"]', { hasText: "추가 라인" })
      .first();
    const netButton = page
      .locator('button[data-slot="button"]', { hasText: "순증 라인" })
      .first();

    await expect(additionsButton).toHaveAttribute("aria-pressed", "true");
    await netButton.click();
    await expect(netButton).toHaveAttribute("aria-pressed", "true");
    await expect(additionsButton).toHaveAttribute("aria-pressed", "false");

    const repoRows = page.locator("table tbody tr");
    await expect(repoRows.first()).toContainText("acme/repo-alpha");

    const prSortButton = page
      .locator("table thead button", { hasText: "PR 생성" })
      .first();
    await prSortButton.click();
    await prSortButton.click();

    await expect(repoRows.first()).toContainText("acme/repo-beta");
  });
});
