import { expect, test } from "@playwright/test";

import {
  buildDashboardAnalyticsFixture,
  buildDashboardAnalyticsForPerson,
} from "@/components/test-harness/dashboard-fixtures";

const PEOPLE_PATH = "/test-harness/people";

test.describe("PeopleView (Playwright)", () => {
  test("auto-selects highest priority contributor and updates on selection", async ({
    page,
  }) => {
    const initialAnalytics = buildDashboardAnalyticsFixture();

    await page.route("**/api/dashboard/analytics**", async (route) => {
      const requestUrl = new URL(route.request().url());
      const fallbackPersonId = initialAnalytics.contributors[0]?.id ?? "user-1";
      const personId =
        requestUrl.searchParams.get("person") ?? fallbackPersonId;

      if (personId === "user-1") {
        const analytics = buildDashboardAnalyticsForPerson(personId);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, analytics }),
        });
        return;
      }

      const analytics = buildDashboardAnalyticsForPerson(personId);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, analytics }),
      });
    });

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/dashboard/analytics") &&
          response.request().method() === "GET",
      ),
      page.goto(PEOPLE_PATH),
    ]);

    await expect(page.getByText("활동 요약 · octoaide")).toBeVisible();
    await expect(page.getByRole("button", { name: "octoaide" })).toHaveClass(
      /bg-primary/,
    );

    const applyButton = page.getByRole("button", {
      name: /필터 적용|갱신 중\.\.\./,
    });

    await page.getByRole("button", { name: "codecov" }).click();
    await expect(applyButton).toBeDisabled();
    await expect(page.getByText("활동 요약 · codecov")).toBeVisible();
    await expect(applyButton).toBeEnabled();
  });
});
