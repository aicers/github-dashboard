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

    const initialList = buildActivityListResultFixture();
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

    await page.route("**/api/activity?**", async (route) => {
      const url = new URL(route.request().url());
      const payload = url.searchParams.has("attention")
        ? filteredList
        : initialList;
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

    await page.getByRole("button", { name: "Discussion" }).click();

    await page.getByRole("button", { name: "현재 필터 저장" }).click();
    const nameInput = page.getByPlaceholder("필터 이름");
    await nameInput.fill("My focus");
    const saveForm = page.locator("form").filter({ has: nameInput });
    await Promise.all([
      saveForm.getByRole("button", { name: "저장" }).click(),
      page.waitForResponse(
        (response) =>
          response.url().includes("/api/activity/filters") &&
          response.request().method() === "POST",
      ),
    ]);

    await page.waitForTimeout(100);

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
    const detailDialog = page.getByRole("dialog");
    await expect(detailDialog).toBeVisible();
    await expect(
      page.getByText("Fixture detail body for filtered item."),
    ).toBeVisible();

    const statusResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/activity/issue-2/status") &&
        response.request().method() === "PATCH",
    );
    await detailDialog.evaluate((element) => {
      const buttons = Array.from(
        element.querySelectorAll<HTMLButtonElement>("button"),
      );
      const target = buttons.find((button) =>
        button.textContent?.includes("Done"),
      );
      if (!target) {
        throw new Error('Expected to find a "Done" button in the dialog');
      }
      target.click();
    });
    await statusResponse;

    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });
});
