import {
  buildActivityItemDetailFixture,
  buildActivityItemFixture,
  buildActivityListResultFixture,
} from "@/components/test-harness/activity-fixtures";
import type { ActivitySavedFilter } from "@/lib/activity/types";
import { expect, test } from "./harness/test";

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
    await page.getByRole("button", { name: /^확인 필요$/ }).click();
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

  test("applies advanced filters and paginates through filtered activity", async ({
    page,
  }) => {
    await page.goto("/test-harness/auth/session?userId=activity-user");

    await page.route("**/api/activity/filters**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ filters: [], limit: 2 }),
      });
    });

    const initialList = buildActivityListResultFixture({
      items: [
        buildActivityItemFixture({
          id: "issue-1",
          number: 101,
          title: "Initial issue",
        }),
      ],
      pageInfo: {
        page: 1,
        perPage: 25,
        totalCount: 2,
        totalPages: 2,
      },
    });

    const advancedList = buildActivityListResultFixture({
      items: [
        buildActivityItemFixture({
          id: "issue-advanced",
          number: 202,
          title: "Advanced filter match",
        }),
      ],
      pageInfo: {
        page: 1,
        perPage: 25,
        totalCount: 2,
        totalPages: 2,
      },
    });

    const emptySecondPage = buildActivityListResultFixture({
      items: [],
      pageInfo: {
        page: 2,
        perPage: 25,
        totalCount: 2,
        totalPages: 2,
      },
    });

    await page.route("**/api/activity?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("page") === "2") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(emptySecondPage),
        });
        return;
      }
      if (url.searchParams.get("repositoryId") === "repo-alpha") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(advancedList),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(initialList),
      });
    });

    await page.goto(ACTIVITY_PATH);

    await page.waitForResponse(
      (response) =>
        response.url().includes("/api/activity/filters") &&
        response.request().method() === "GET",
    );

    await page.getByRole("button", { name: "고급 필터 보기" }).click();

    const applyButton = page.getByRole("button", { name: "필터 적용" });
    await expect(applyButton).toBeDisabled();

    const repoInput = page.getByPlaceholder("저장소 선택");
    await repoInput.fill("acme");
    await repoInput.press("Enter");

    const labelInput = page.getByPlaceholder("라벨 선택");
    await labelInput.fill("bug");
    await labelInput.press("Enter");

    const applyResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/activity") &&
        response.request().method() === "GET" &&
        response.url().includes("repositoryId=repo-alpha"),
    );
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await applyResponse;

    await expect(
      page.getByRole("button", { name: /Advanced filter match/ }),
    ).toBeVisible();

    const nextPageResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/activity") &&
        response.request().method() === "GET" &&
        response.url().includes("page=2"),
    );
    await page.getByRole("button", { name: "다음" }).click();
    await nextPageResponse;

    await expect(
      page.getByText("필터 조건에 맞는 활동이 없습니다."),
    ).toBeVisible();
    await expect(page.getByText("페이지 2 / 2 (총 2건)")).toBeVisible();
    await expect(page.getByRole("button", { name: "다음" })).toBeDisabled();
  });
});

const PERSON_PARAM_KEYS = [
  "authorId",
  "assigneeId",
  "reviewerId",
  "mentionedUserId",
  "commenterId",
  "reactorId",
  "maintainerId",
] as const;

type PersonParamKey = (typeof PERSON_PARAM_KEYS)[number];

const ATTENTION_SCENARIOS: Array<{
  name: string;
  attentionLabels: string[];
  attentionValues: string[];
  expected: Partial<Record<PersonParamKey, string[]>>;
}> = [
  {
    name: "issue_stalled",
    attentionLabels: ["정체된 In Progress 이슈"],
    attentionValues: ["issue_stalled"],
    expected: { assigneeId: ["user-alice"] },
  },
  {
    name: "pr_inactive",
    attentionLabels: ["업데이트 없는 PR"],
    attentionValues: ["pr_inactive"],
    expected: {
      authorId: ["user-alice"],
      assigneeId: ["user-alice"],
      reviewerId: ["user-alice"],
      maintainerId: ["user-alice"],
    },
  },
  {
    name: "review_requests_pending",
    attentionLabels: ["응답 없는 리뷰 요청"],
    attentionValues: ["review_requests_pending"],
    expected: {
      reviewerId: ["user-alice"],
    },
  },
  {
    name: "unanswered_mentions",
    attentionLabels: ["응답 없는 멘션"],
    attentionValues: ["unanswered_mentions"],
    expected: {
      mentionedUserId: ["user-alice"],
    },
  },
];

test.describe("ActivityView attention + people query mapping", () => {
  for (const scenario of ATTENTION_SCENARIOS) {
    test(`maps ${scenario.name} to expected query params`, async ({ page }) => {
      await page.goto("/test-harness/auth/session?userId=activity-user");

      await page.route("**/api/activity/filters**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ filters: [], limit: 5 }),
        });
      });

      await page.route("**/api/activity?**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildActivityListResultFixture()),
        });
      });

      await page.goto(ACTIVITY_PATH);
      await page.waitForTimeout(200);

      await page.getByRole("button", { name: "alice" }).click();
      for (const label of scenario.attentionLabels) {
        await page.getByRole("button", { name: label }).click();
      }

      await page.getByRole("button", { name: "고급 필터 보기" }).click();

      const applyButton = page.getByRole("button", { name: "필터 적용" });
      await expect(applyButton).toBeEnabled();

      const requestPromise = page.waitForRequest((request) => {
        if (!request.url().includes("/api/activity")) {
          return false;
        }
        if (request.method() !== "GET") {
          return false;
        }
        return scenario.attentionValues.every((value) =>
          request.url().includes(`attention=${value}`),
        );
      });

      await applyButton.click();
      const request = await requestPromise;
      const url = new URL(request.url());

      expect(url.searchParams.getAll("attention")).toEqual(
        scenario.attentionValues,
      );

      for (const [key, expectedValues] of Object.entries(scenario.expected)) {
        expect(url.searchParams.getAll(key)).toEqual(expectedValues);
      }

      const absentKeys = PERSON_PARAM_KEYS.filter(
        (key) => !(key in scenario.expected),
      );
      for (const key of absentKeys) {
        expect(url.searchParams.has(key)).toBe(false);
      }
    });
  }
});

test.describe("ActivityView thresholds & tooltips", () => {
  test.setTimeout(30000);

  test("renders five threshold inputs with expected labels in advanced filter", async ({
    page,
  }) => {
    await page.goto("/test-harness/auth/session?userId=activity-user");

    await page.route("**/api/activity/filters**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ filters: [], limit: 5 }),
      });
    });

    await page.route("**/api/activity?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildActivityListResultFixture()),
      });
    });

    await page.goto(ACTIVITY_PATH);
    await page.waitForTimeout(200);

    await page.getByRole("button", { name: "고급 필터 보기" }).click();

    const labels = [
      "정체 Backlog 이슈 기준일",
      "정체 In Progress 이슈 기준일",
      "업데이트 없는 PR 기준일",
      "응답 없는 리뷰 기준일",
      "응답 없는 멘션 기준일",
    ];

    const placeholders = [
      "Backlog 정체",
      "In Progress 정체",
      "PR 정체",
      "리뷰 무응답",
      "멘션 무응답",
    ];

    for (const label of labels) {
      await expect(page.getByText(label)).toBeVisible();
    }

    for (const placeholder of placeholders) {
      await expect(page.getByPlaceholder(placeholder)).toBeVisible();
    }
  });

  test("shows updated tooltip text for 업데이트 없는 PR attention chip", async ({
    page,
  }) => {
    await page.goto("/test-harness/auth/session?userId=activity-user");

    await page.route("**/api/activity/filters**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ filters: [], limit: 5 }),
      });
    });

    await page.route("**/api/activity?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildActivityListResultFixture()),
      });
    });

    await page.goto(ACTIVITY_PATH);
    await page.waitForTimeout(200);

    const attentionChip = page.getByRole("button", {
      name: "업데이트 없는 PR",
    });
    await attentionChip.hover();

    const tooltipText =
      "구성원 선택 시, 구성원이 PR의 작성자, 담당자, 리뷰어, 또는 저장소 책임자인 항목만 표시합니다. octoaide가 남긴 활동은 업데이트로 간주하지 않습니다.";
    await expect(page.getByText(tooltipText)).toBeVisible();
    await expect(page.getByText(tooltipText)).toHaveText(
      "구성원 선택 시, 구성원이 PR의 작성자, 담당자, 리뷰어, 또는 저장소 책임자인 항목만 표시합니다. octoaide가 남긴 활동은 업데이트로 간주하지 않습니다.",
    );
  });
});
