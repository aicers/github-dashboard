import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RepositorySearchCard } from "./repository-search";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RepositorySearchCard", () => {
  it("shows validation errors when fields are empty", async () => {
    const user = userEvent.setup();

    render(<RepositorySearchCard />);

    await user.clear(screen.getByLabelText(/owner/i));
    await user.clear(screen.getByLabelText(/repository/i));
    await user.click(screen.getByRole("button", { name: /run test/i }));

    expect(
      await screen.findByText("Owner (user or organization) is required."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Repository name is required."),
    ).toBeInTheDocument();
  });

  it("renders repository details when the API resolves", async () => {
    const user = userEvent.setup();
    const mockRepository = {
      name: "next.js",
      description: "The React Framework",
      url: "https://github.com/vercel/next.js",
      stars: 123,
      forks: 456,
      openIssues: 10,
      openPullRequests: 5,
      defaultBranch: "canary",
      updatedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
    };

    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ repository: mockRepository }),
    } as unknown as Response);

    render(<RepositorySearchCard />);

    await user.click(screen.getByRole("button", { name: /run test/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/github/repository",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    const starsLabel = await screen.findByText(/Stars:/);
    const starsLine = starsLabel.closest("p");
    expect(starsLine).toBeTruthy();
    expect(starsLine).toHaveTextContent(/123/);
    expect(
      screen.getByRole("link", { name: /View on GitHub/i }),
    ).toHaveAttribute("href", mockRepository.url);
  });
});
