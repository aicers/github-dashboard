import { expect, test } from "./harness/test";

const DASHBOARD_ROOT = "/dashboard";
const DASHBOARD_TABS_PATH = "/test-harness/dashboard-tabs";

test.describe("Dashboard navigation (Playwright)", () => {
  test.setTimeout(120_000);

  test("redirects unauthenticated users to GitHub sign-in", async ({
    page,
  }) => {
    await page.goto(DASHBOARD_ROOT);
    await expect(page).toHaveURL(/https:\/\/github\.com\/login/);
  });

  test("redirects /dashboard to /dashboard/activity", async ({ page }) => {
    await page.goto("/test-harness/auth/session?userId=e2e-user");
    await page.goto(DASHBOARD_ROOT);
    await expect(page).toHaveURL(/\/dashboard\/activity$/);
  });

  test("highlights active tab and updates on navigation", async ({ page }) => {
    await page.goto(DASHBOARD_TABS_PATH);

    const currentPath = page.getByTestId("current-path");
    await expect(currentPath).toContainText("/dashboard/activity");

    const activityTab = page.getByRole("link", { name: "Activity" });
    await expect(activityTab).toHaveClass(/text-primary/);
    const analyticsTab = page.getByRole("link", { name: "Analytics" });
    await expect(analyticsTab).toHaveAttribute("href", "/dashboard/analytics");
    const peopleTab = page.getByRole("link", { name: "People" });
    await expect(peopleTab).toHaveAttribute("href", "/dashboard/people");

    await page.getByTestId("set-path-people").click();
    await expect(currentPath).toContainText("/dashboard/people");
    await expect(peopleTab).toHaveClass(/text-primary/);
  });
});
