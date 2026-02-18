import {
  buildDashboardAnalyticsFixture,
  buildDashboardAnalyticsForPerson,
} from "@/components/test-harness/dashboard-fixtures";
import { expect, test } from "./harness/test";

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

    await page.goto(PEOPLE_PATH);

    const contributorNames = initialAnalytics.contributors.map(
      (person) => person.login ?? person.name ?? person.id,
    );
    const resolveActiveContributor = async () => {
      for (const name of contributorNames) {
        const className = await page
          .getByRole("button", { name })
          .getAttribute("class");
        if (className?.includes("bg-primary")) {
          return name;
        }
      }
      return "";
    };
    await expect.poll(resolveActiveContributor).not.toBe("");
    const activeContributor = await resolveActiveContributor();

    await expect(
      page.getByText(`활동 요약 · ${activeContributor}`),
    ).toBeVisible();

    const applyButton = page.getByRole("button", {
      name: /필터 적용|갱신 중\.\.\./,
    });

    await page.getByRole("button", { name: "codecov" }).click();
    await expect(applyButton).toBeDisabled();
    await expect(page.getByText("활동 요약 · codecov")).toBeVisible();
    await expect(applyButton).toBeDisabled();
  });
});
