import { expect, test } from "./harness/test";

const GITHUB_TEST_PATH = "/github-test";

test.describe("RepositorySearchCard (Playwright)", () => {
  test("fetches repository details successfully", async ({ page }) => {
    const repositoryResponse = {
      repository: {
        name: "playwright",
        description: "End-to-end testing for modern web apps",
        stars: 12345,
        forks: 5432,
        openIssues: 12,
        openPullRequests: 3,
        defaultBranch: "main",
        updatedAt: "2024-02-01T10:00:00.000Z",
        url: "https://github.com/microsoft/playwright",
      },
    };

    await page.route("**/api/github/repository", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(repositoryResponse),
      });
    });

    await page.goto(GITHUB_TEST_PATH);

    const runButton = page.locator('form button[type="submit"]');
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/github/repository") &&
        response.request().method() === "POST",
    );
    await runButton.click();
    await responsePromise;
    await expect(page.getByText("Stars: 12,345")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View on GitHub" }),
    ).toHaveAttribute("href", repositoryResponse.repository.url);
    await expect(runButton).toBeEnabled();
  });

  test("handles validation errors and API failures", async ({ page }) => {
    await page.route("**/api/github/repository", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ message: "Repository not found" }),
      });
    });

    await page.goto(GITHUB_TEST_PATH);

    const ownerInput = page.getByLabel("Owner (user or organization)");
    const nameInput = page.getByLabel("Repository");
    const runButton = page.locator('form button[type="submit"]');

    await ownerInput.fill("");
    await nameInput.fill("");
    await runButton.click();

    await expect(
      page.getByText("Owner (user or organization) is required."),
    ).toBeVisible();
    await expect(page.getByText("Repository name is required.")).toBeVisible();

    await ownerInput.fill("octocat");
    await nameInput.fill("unknown-repo");
    await runButton.click();

    await expect(page.getByText("Repository not found")).toBeVisible();
  });
});
