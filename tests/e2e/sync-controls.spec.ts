import { expect, test } from "@playwright/test";

const SYNC_PATH = "/test-harness/sync";

test.describe("SyncControls (Playwright)", () => {
  test("runs manual backfill and records history with feedback", async ({
    page,
  }) => {
    await page.goto(SYNC_PATH);

    const backfillResult = {
      startDate: "2024-04-01T00:00:00.000Z",
      endDate: "2024-04-02T00:00:00.000Z",
      chunkCount: 1,
      totals: {
        issues: 5,
        discussions: 2,
        pullRequests: 3,
        reviews: 2,
        comments: 7,
      },
      chunks: [
        {
          status: "success" as const,
          since: "2024-04-01T00:00:00.000Z",
          until: "2024-04-02T00:00:00.000Z",
          startedAt: "2024-04-01T00:00:01.000Z",
          completedAt: "2024-04-01T00:05:00.000Z",
          summary: {
            repositoriesProcessed: 1,
            counts: {
              issues: 5,
              discussions: 2,
              pullRequests: 3,
              reviews: 2,
              comments: 7,
            },
            timestamps: {
              repositories: null,
              issues: null,
              discussions: null,
              pullRequests: null,
              reviews: null,
              comments: null,
            },
          },
        },
      ],
    };

    await page.route("**/api/sync/backfill", async (route) => {
      expect(route.request().method()).toBe("POST");
      const payload = route.request().postDataJSON() as { startDate: string };
      expect(payload.startDate).toMatch(/\d{4}-\d{2}-\d{2}/);

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, result: backfillResult }),
      });
    });

    await page.getByRole("button", { name: "백필 실행", exact: true }).click();

    await expect(
      page.getByText("백필이 성공적으로 실행되었습니다."),
    ).toBeVisible();

    // Debug output to inspect DOM state during test development
    await expect(page.getByText("백필 결과 히스토리")).toBeVisible();
    await expect(page.getByText(/실행 #1\s+•/)).toBeVisible();
    await expect(
      page.getByText(/이슈 5\s+\/ 토론 2\s+\/ PR 3\s+\/ 리뷰 2\s+\/ 댓글 7/),
    ).toBeVisible();
  });

  test("shows chunk failure feedback when manual backfill partially fails", async ({
    page,
  }) => {
    await page.goto(SYNC_PATH);

    await page.route("**/api/sync/backfill", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          result: {
            startDate: "2024-04-01T00:00:00.000Z",
            endDate: "2024-04-03T00:00:00.000Z",
            chunkCount: 2,
            totals: {
              issues: 5,
              discussions: 1,
              pullRequests: 4,
              reviews: 3,
              comments: 2,
            },
            chunks: [
              {
                status: "success",
                since: "2024-04-01T00:00:00.000Z",
                until: "2024-04-02T00:00:00.000Z",
                summary: {
                  repositoriesProcessed: 1,
                  counts: {
                    issues: 3,
                    discussions: 1,
                    pullRequests: 2,
                    reviews: 2,
                    comments: 1,
                  },
                  timestamps: {
                    repositories: null,
                    issues: null,
                    discussions: null,
                    pullRequests: null,
                    reviews: null,
                    comments: null,
                  },
                },
              },
              {
                status: "failed",
                since: "2024-04-02T00:00:00.000Z",
                until: "2024-04-03T00:00:00.000Z",
                error: "API rate limit exceeded",
              },
            ],
          },
        }),
      });
    });

    await page.getByRole("button", { name: "백필 실행", exact: true }).click();

    await expect(
      page.getByText(
        /백필이 .* 구간에서 실패했습니다: API rate limit exceeded/,
      ),
    ).toBeVisible();
  });

  test("toggles auto sync on success and shows descriptive feedback on failure", async ({
    page,
  }) => {
    await page.goto(SYNC_PATH);

    let toggleCount = 0;
    await page.route("**/api/sync/auto", async (route) => {
      toggleCount += 1;

      if (toggleCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          message: "자동 동기화를 변경할 수 없습니다.",
        }),
      });
    });

    const toggleButton = page.getByRole("button", { name: "자동 동기화 중단" });
    await toggleButton.click();

    await expect(page.getByText("자동 동기화를 중단했습니다.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "자동 동기화 시작" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "자동 동기화 시작" }).click();

    await expect(
      page.getByText("자동 동기화를 변경할 수 없습니다."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "자동 동기화 시작" }),
    ).toBeVisible();
  });

  test("confirms data reset and handles success and failure flows", async ({
    page,
  }) => {
    await page.goto(SYNC_PATH);

    let resetCount = 0;
    await page.route("**/api/sync/reset", async (route) => {
      resetCount += 1;
      if (resetCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          message: "초기화 실패: 권한 오류",
        }),
      });
    });

    await page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain(
        "정말로 모든 데이터를 삭제하시겠습니까?",
      );
      await dialog.accept();
    });
    await page.getByRole("button", { name: "모든 데이터 삭제" }).click();

    await expect(page.getByText("데이터가 초기화되었습니다.")).toBeVisible();

    await page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole("button", { name: "모든 데이터 삭제" }).click();

    await expect(page.getByText("초기화 실패: 권한 오류")).toBeVisible();
  });
});
