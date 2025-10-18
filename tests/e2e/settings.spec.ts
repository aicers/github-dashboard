import { expect, test } from "@playwright/test";

const SETTINGS_PATH = "/test-harness/settings";

test.describe("SettingsView (Playwright)", () => {
  test("renders the preconfigured values and summary counts", async ({
    page,
  }) => {
    await page.goto(SETTINGS_PATH);

    await expect(
      page.getByText("각 구성원과 전체 조직 관련 사항을 설정합니다."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Personal" }),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.getByLabel("표준 시간대")).toHaveValue("Asia/Seoul");
    await expect(page.getByLabel("주의 시작 요일")).toHaveValue("monday");

    await page.getByRole("button", { name: "Organization" }).click();

    await expect(
      page.getByRole("button", { name: "Organization" }),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.getByLabel("Organization 이름")).toHaveValue("acme");
    await expect(page.getByLabel("자동 동기화 주기 (분)")).toHaveValue("30");
    await expect(
      page.getByRole("option", { name: "acme/repo-two" }),
    ).toBeAttached();
    await expect(
      page
        .getByLabel("제외할 구성원을 선택하세요")
        .getByRole("option", { name: "monalisa" }),
    ).toBeAttached();
    await expect(page.getByLabel("로그인 허용 팀을 선택하세요")).toHaveValues([
      "core-team",
    ]);
    await expect(
      page.getByLabel("로그인 허용 개별 구성원을 선택하세요"),
    ).toHaveValues(["MDQ6VXNlcjEwMA=="]);
    await expect(
      page.getByText("허용된 팀: 1개 · 허용된 구성원: 1명"),
    ).toBeVisible();
    await expect(page.getByLabel("제외할 저장소를 선택하세요")).toHaveValues([
      "repo-2",
    ]);
    await expect(page.getByLabel("제외할 구성원을 선택하세요")).toHaveValues([
      "user-3",
    ]);

    await expect(page.getByText("제외된 저장소: 1개")).toBeVisible();
    await expect(page.getByText("제외된 구성원: 1명")).toBeVisible();
  });

  test("submits trimmed values and shows a success message", async ({
    page,
  }) => {
    await page.goto(SETTINGS_PATH);

    let capturedPayload: Record<string, unknown> | undefined;
    await page.route("**/api/sync/config", async (route) => {
      const request = route.request();
      capturedPayload = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.getByRole("button", { name: "Organization" }).click();

    await page.getByLabel("Organization 이름").fill("  new-org  ");
    await page.getByLabel("자동 동기화 주기 (분)").fill("");
    await page.getByLabel("자동 동기화 주기 (분)").fill("15");
    await page.getByLabel("표준 시간대").selectOption("Europe/London");
    await page.getByLabel("주의 시작 요일").selectOption("sunday");
    await page
      .getByLabel("제외할 저장소를 선택하세요")
      .selectOption(["repo-1", "repo-3"]);
    await page
      .getByLabel("제외할 구성원을 선택하세요")
      .selectOption(["user-1", "user-2"]);
    await page
      .getByLabel("로그인 허용 팀을 선택하세요")
      .selectOption(["qa-team"]);
    await page
      .getByLabel("로그인 허용 개별 구성원을 선택하세요")
      .selectOption(["MDQ6VXNlcjEwMQ=="]);

    await page.getByRole("button", { name: "조직 설정 저장" }).click();

    await expect(page.getByText("설정이 저장되었습니다.")).toBeVisible();

    expect(capturedPayload).toBeDefined();
    expect(capturedPayload).toMatchObject({
      orgName: "new-org",
      syncIntervalMinutes: 15,
      timezone: "Europe/London",
      weekStart: "sunday",
    });
    const excludedRepositories = Array.from(
      (capturedPayload?.excludedRepositories as string[]) ?? [],
    ).sort();
    const excludedPeople = Array.from(
      (capturedPayload?.excludedPeople as string[]) ?? [],
    ).sort();
    const allowedTeams = Array.from(
      (capturedPayload?.allowedTeams as string[]) ?? [],
    ).sort();
    const allowedUsers = Array.from(
      (capturedPayload?.allowedUsers as string[]) ?? [],
    ).sort();
    expect(excludedRepositories).toEqual(["repo-1", "repo-3"]);
    expect(excludedPeople).toEqual(["user-1", "user-2"]);
    expect(allowedTeams).toEqual(["qa-team"]);
    expect(allowedUsers).toEqual(["MDQ6VXNlcjEwMQ=="]);
  });

  test("shows validation errors without hitting the API", async ({ page }) => {
    await page.goto(SETTINGS_PATH);

    let called = false;
    await page.route("**/api/sync/config", async (route) => {
      called = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.getByRole("button", { name: "Organization" }).click();

    await page.getByLabel("자동 동기화 주기 (분)").fill("");
    await page.getByLabel("자동 동기화 주기 (분)").fill("0");
    await page.getByRole("button", { name: "조직 설정 저장" }).click();

    await expect(
      page.getByText("동기화 주기는 1 이상의 정수여야 합니다."),
    ).toBeVisible();
    expect(called).toBe(false);
  });

  test("clears excluded selections and updates the counters", async ({
    page,
  }) => {
    await page.goto(SETTINGS_PATH);

    await page.getByRole("button", { name: "Organization" }).click();

    const clearButtons = await page
      .getByRole("button", { name: "제외 목록 비우기" })
      .all();
    expect(clearButtons).toHaveLength(2);
    const [clearRepos, clearMembers] = clearButtons;

    await clearRepos.click();
    await expect(page.getByText("제외된 저장소: 0개")).toBeVisible();
    await expect(clearRepos).toBeDisabled();

    await clearMembers.click();
    await expect(page.getByText("제외된 구성원: 0명")).toBeVisible();
    await expect(clearMembers).toBeDisabled();
  });
});
