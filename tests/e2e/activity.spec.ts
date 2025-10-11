import { expect, test } from "@playwright/test";

import {
  buildActivityItemDetailFixture,
  buildActivityItemFixture,
  buildActivityListResultFixture,
} from "@/components/test-harness/activity-fixtures";
import type { ActivitySavedFilter } from "@/lib/activity/types";

const ACTIVITY_PATH = "/test-harness/activity";

test.describe("ActivityView (Playwright)", () => {
  test.setTimeout(45000);

  test("saves filters, applies quick filter, loads detail, and updates status", async ({
    page,
  }) => {
    await page.goto("/test-harness/auth/session?userId=activity-user");

    const savedFilters: ActivitySavedFilter[] = [];

    await page.route("**/api/activity/filters**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ filters: savedFilters, limit: 5 }),
        });
        return;
      }

      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON() as {
          name: string;
          payload: ActivitySavedFilter["payload"];
        };

        const filter: ActivitySavedFilter = {
          id: `saved-${savedFilters.length + 1}`,
          name: payload.name,
          payload: payload.payload,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        savedFilters.unshift(filter);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ filter, limit: 5 }),
        });
        return;
      }

      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Unhandled request" }),
      });
    });

    const filteredList = buildActivityListResultFixture({
      items: [
        buildActivityItemFixture({
          id: "issue-2",
          number: 202,
          title: "Filtered critical issue",
          issueProjectStatus: "todo",
          issueTodoProjectStatus: "todo",
          issueTodoProjectPriority: "P0",
        }),
      ],
    });

    const initialList = buildActivityListResultFixture();

    await page.route("**/api/activity?**", async (route) => {
      const url = new URL(route.request().url());
      const hasAttention = url.searchParams.has("attention");
      const payload = hasAttention ? filteredList : initialList;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    });

    const detailResponse = buildActivityItemDetailFixture({
      item: buildActivityItemFixture({
        id: "issue-2",
        number: 202,
        title: "Filtered critical issue",
        issueProjectStatus: "todo",
        issueTodoProjectStatus: "todo",
      }),
      body: "Fixture detail body for filtered item.",
    });

    await page.route("**/api/activity/issue-2", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(detailResponse),
      });
    });

    const updatedItem = buildActivityItemFixture({
      id: "issue-2",
      number: 202,
      title: "Filtered critical issue",
      issueProjectStatus: "done",
      issueTodoProjectStatus: "done",
    });

    await page.route("**/api/activity/issue-2/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ item: updatedItem }),
      });
    });

    await page.goto(ACTIVITY_PATH);

    await page.waitForResponse(
      (response) =>
        response.url().includes("/api/activity/filters") &&
        response.request().method() === "GET",
    );

    await expect(
      page.getByRole("button", { name: /Controller returns incorrect status/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Issue" }).click();
    await page.getByRole("button", { name: "현재 필터 저장" }).click();
    const nameInput = page.getByPlaceholder("필터 이름");
    await nameInput.fill("My focus");
    const saveForm = page.locator("form").filter({ has: nameInput });
    await saveForm.getByRole("button", { name: "저장" }).click();
    await expect(page.locator("select").first()).toContainText("My focus");

    const feedResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/activity") &&
        response.url().includes("attention=") &&
        response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "주의 필요한 업데이트" }).click();
    await feedResponse;
    await expect(
      page.getByRole("button", { name: /Filtered critical issue/ }),
    ).toBeVisible();

    const detailRequest = page.waitForResponse(
      (response) =>
        response.url().includes("/api/activity/issue-2") &&
        response.request().method() === "GET",
    );
    await page
      .getByRole("button", {
        name: /Filtered critical issue/,
      })
      .click();
    await detailRequest;
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByText("Fixture detail body for filtered item."),
    ).toBeVisible();

    const statusResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/activity/issue-2/status") &&
        response.request().method() === "PATCH",
    );
    await page.waitForTimeout(200);
    await page
      .locator('[role="dialog"] button:has-text("Done")')
      .first()
      .click({ force: true, noWaitAfter: true });
    await statusResponse;
    await expect(page.getByText("상태를 Done로 업데이트했어요.")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });
});
