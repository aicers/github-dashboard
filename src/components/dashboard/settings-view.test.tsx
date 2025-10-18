import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsView } from "@/components/dashboard/settings-view";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";
import { fetchMock, mockFetchJsonOnce } from "../../../tests/setup/mock-fetch";

const routerRefreshMock = vi.fn();
const intlWithSupported = Intl as typeof Intl & {
  supportedValuesOf?: (keys: string) => string[];
};
if (typeof intlWithSupported.supportedValuesOf !== "function") {
  intlWithSupported.supportedValuesOf = () => [];
}
const supportedValuesSpy = vi.spyOn(intlWithSupported, "supportedValuesOf");

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
}));

const repositories: RepositoryProfile[] = [
  {
    id: "repo-1",
    name: "Repo One",
    nameWithOwner: "acme/repo-one",
  },
  {
    id: "repo-2",
    name: "Repo Two",
    nameWithOwner: "acme/repo-two",
  },
  {
    id: "repo-3",
    name: "Repo Three",
    nameWithOwner: "acme/repo-three",
  },
];

const members: UserProfile[] = [
  {
    id: "user-1",
    login: "octocat",
    name: "Octo Cat",
    avatarUrl: null,
  },
  {
    id: "user-2",
    login: "hubot",
    name: "Hubot",
    avatarUrl: null,
  },
  {
    id: "user-3",
    login: "monalisa",
    name: "Mona Lisa",
    avatarUrl: null,
  },
];

const organizationTeams = [
  {
    id: 10,
    nodeId: "T_kwDOABCDE",
    slug: "core-team",
    name: "Core Team",
    description: null,
  },
  {
    id: 11,
    nodeId: "T_kwDOABCD2",
    slug: "qa-team",
    name: "QA Team",
    description: null,
  },
];

const organizationMembers = [
  {
    id: 100,
    nodeId: "MDQ6VXNlcjEwMA==",
    login: "octocat",
    avatarUrl: null,
  },
  {
    id: 101,
    nodeId: "MDQ6VXNlcjEwMQ==",
    login: "hubot",
    avatarUrl: null,
  },
  {
    id: 102,
    nodeId: "MDQ6VXNlcjEwMg==",
    login: "monalisa",
    avatarUrl: null,
  },
];

function renderSettings(
  overrides: Partial<ComponentProps<typeof SettingsView>> = {},
) {
  return render(
    <SettingsView
      orgName="acme"
      syncIntervalMinutes={30}
      timeZone="Asia/Seoul"
      weekStart="monday"
      dateTimeFormat="auto"
      repositories={repositories}
      excludedRepositoryIds={["repo-2"]}
      members={members}
      excludedMemberIds={["user-3"]}
      allowedTeamSlugs={["core-team"]}
      allowedUserIds={["MDQ6VXNlcjEwMA=="]}
      organizationTeams={organizationTeams}
      organizationMembers={organizationMembers}
      isAdmin
      currentUserId="user-1"
      currentUserName="Octo Cat"
      currentUserLogin="octocat"
      currentUserAvatarUrl={null}
      currentUserOriginalAvatarUrl="https://example.com/original.png"
      currentUserCustomAvatarUrl={null}
      {...overrides}
    />,
  );
}

describe("SettingsView", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
    supportedValuesSpy.mockImplementation(() => [
      "UTC",
      "Asia/Seoul",
      "America/Los_Angeles",
    ]);
  });

  afterEach(() => {
    supportedValuesSpy.mockReset();
  });

  it("renders the current configuration values and summary counts", async () => {
    const user = userEvent.setup();

    renderSettings();

    const personalSection = screen
      .getByRole("button", { name: "개인 설정 저장" })
      .closest("section");
    expect(personalSection).not.toBeNull();

    expect(
      within(personalSection as HTMLElement).getByLabelText("표준 시간대"),
    ).toHaveValue("Asia/Seoul");
    expect(
      within(personalSection as HTMLElement).getByLabelText("주의 시작 요일"),
    ).toHaveValue("monday");
    expect(
      within(personalSection as HTMLElement).getByLabelText("날짜와 시간"),
    ).toHaveValue("auto");
    expect(
      within(personalSection as HTMLElement).getByRole("button", {
        name: "개인 설정 저장",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Organization" }));

    const organizationSection = (
      await screen.findByRole("button", { name: "조직 설정 저장" })
    ).closest("section");
    expect(organizationSection).not.toBeNull();

    expect(
      within(organizationSection as HTMLElement).getByLabelText(
        "Organization 이름",
      ),
    ).toHaveValue("acme");
    expect(
      within(organizationSection as HTMLElement).getByLabelText(
        "자동 동기화 주기 (분)",
      ),
    ).toHaveValue(30);
    expect(
      within(organizationSection as HTMLElement).getByLabelText("표준 시간대"),
    ).toHaveValue("Asia/Seoul");
    expect(
      within(organizationSection as HTMLElement).getByLabelText(
        "주의 시작 요일",
      ),
    ).toHaveValue("monday");
    expect(
      within(organizationSection as HTMLElement).getByLabelText("날짜와 시간"),
    ).toHaveValue("auto");
    const allowedTeamSelect = within(
      organizationSection as HTMLElement,
    ).getByLabelText(/로그인 허용 팀/) as HTMLSelectElement;
    expect(
      Array.from(allowedTeamSelect.selectedOptions).map(
        (option) => option.value,
      ),
    ).toEqual(["core-team"]);
    const allowedUserSelect = within(
      organizationSection as HTMLElement,
    ).getByLabelText(
      /로그인 허용 개별 구성원을 선택하세요/,
    ) as HTMLSelectElement;
    expect(
      Array.from(allowedUserSelect.selectedOptions).map(
        (option) => option.value,
      ),
    ).toEqual(["MDQ6VXNlcjEwMA=="]);
    expect(
      within(organizationSection as HTMLElement).getByText(
        "허용된 팀: 1개 · 허용된 구성원: 1명",
      ),
    ).toBeInTheDocument();
    expect(
      within(organizationSection as HTMLElement).getByRole("option", {
        name: "acme/repo-two",
      }),
    ).toBeInTheDocument();
    expect(
      within(organizationSection as HTMLElement).getAllByRole("option", {
        name: "monalisa",
      }).length,
    ).toBeGreaterThan(0);
    expect(
      within(organizationSection as HTMLElement).getByText(
        "제외된 리포지토리: 1개",
        { selector: "span" },
      ),
    ).toBeInTheDocument();
    expect(
      within(organizationSection as HTMLElement).getByText(
        "제외된 구성원: 1명",
        { selector: "span" },
      ),
    ).toBeInTheDocument();
    expect(
      within(organizationSection as HTMLElement).getByRole("button", {
        name: "조직 설정 저장",
      }),
    ).toBeInTheDocument();
  });

  it("submits trimmed values and refreshes the dashboard on success", async () => {
    const user = userEvent.setup();
    mockFetchJsonOnce({ success: true });

    renderSettings();

    await user.click(screen.getByRole("button", { name: "Organization" }));

    const organizationSection = (
      await screen.findByRole("button", { name: "조직 설정 저장" })
    ).closest("section") as HTMLElement;

    const orgInput =
      within(organizationSection).getByLabelText("Organization 이름");
    await user.clear(orgInput);
    await user.type(orgInput, "  new-org  ");

    const intervalInput = within(organizationSection).getByLabelText(
      "자동 동기화 주기 (분)",
    );
    await user.clear(intervalInput);
    await user.type(intervalInput, "15");

    const timezoneSelect =
      within(organizationSection).getByLabelText("표준 시간대");
    await user.selectOptions(timezoneSelect, "America/Los_Angeles");

    const weekStartSelect =
      within(organizationSection).getByLabelText("주의 시작 요일");
    await user.selectOptions(weekStartSelect, "sunday");

    const repoSelect =
      within(organizationSection).getByLabelText(
        /제외할 리포지토리를 선택하세요/,
      );
    await user.deselectOptions(repoSelect, ["repo-2"]);
    await user.selectOptions(repoSelect, ["repo-1", "repo-3"]);

    const memberSelect =
      within(organizationSection).getByLabelText(/제외할 구성원을 선택하세요/);
    await user.deselectOptions(memberSelect, ["user-3"]);
    await user.selectOptions(memberSelect, ["user-1", "user-2"]);

    await user.click(screen.getByRole("button", { name: "조직 설정 저장" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain("/api/sync/config");
    expect(request.method).toBe("PATCH");
    const payload = await request.clone().json();
    expect(payload).toMatchObject({
      orgName: "new-org",
      syncIntervalMinutes: 15,
      timezone: "America/Los_Angeles",
      weekStart: "sunday",
      dateTimeFormat: "auto",
    });
    expect([...payload.excludedRepositories].sort()).toEqual([
      "repo-1",
      "repo-3",
    ]);
    expect([...payload.excludedPeople].sort()).toEqual(["user-1", "user-2"]);
    expect([...payload.allowedTeams].sort()).toEqual(["core-team"]);
    expect([...payload.allowedUsers].sort()).toEqual(["MDQ6VXNlcjEwMA=="]);

    await waitFor(() => {
      expect(routerRefreshMock).toHaveBeenCalled();
    });

    expect(
      screen.getByText("설정이 저장되었습니다.", { selector: "p" }),
    ).toBeInTheDocument();
  });

  it("updates allowed teams and members", async () => {
    const user = userEvent.setup();
    mockFetchJsonOnce({ success: true });

    renderSettings();

    await user.click(screen.getByRole("button", { name: "Organization" }));

    const organizationSection = (
      await screen.findByRole("button", { name: "조직 설정 저장" })
    ).closest("section") as HTMLElement;

    const teamSelect =
      within(organizationSection).getByLabelText(/로그인 허용 팀/);
    await user.selectOptions(teamSelect, ["core-team", "qa-team"]);

    const memberSelect =
      within(organizationSection).getByLabelText(
        /로그인 허용 개별 구성원을 선택하세요/,
      );
    await user.selectOptions(memberSelect, [
      "MDQ6VXNlcjEwMA==",
      "MDQ6VXNlcjEwMQ==",
    ]);

    expect(
      within(organizationSection).getByText(
        "허용된 팀: 2개 · 허용된 구성원: 2명",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "조직 설정 저장" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    const payload = await request.clone().json();
    expect(new Set(payload.allowedTeams)).toEqual(
      new Set(["core-team", "qa-team"]),
    );
    expect(new Set(payload.allowedUsers)).toEqual(
      new Set(["MDQ6VXNlcjEwMA==", "MDQ6VXNlcjEwMQ=="]),
    );
  });

  it("shows validation errors without calling the API when input is invalid", async () => {
    const user = userEvent.setup();

    renderSettings();

    await user.click(screen.getByRole("button", { name: "Organization" }));

    const organizationSection = (
      await screen.findByRole("button", { name: "조직 설정 저장" })
    ).closest("section") as HTMLElement;

    const intervalInput = within(organizationSection).getByLabelText(
      "자동 동기화 주기 (분)",
    );
    await user.clear(intervalInput);
    await user.type(intervalInput, "0");

    await user.click(
      within(organizationSection).getByRole("button", {
        name: "조직 설정 저장",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("동기화 주기는 1 이상의 정수여야 합니다.", {
          selector: "p",
        }),
      ).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears excluded selections and updates their counts", async () => {
    const user = userEvent.setup();

    renderSettings();

    await user.click(screen.getByRole("button", { name: "Organization" }));

    const organizationSection = (
      await screen.findByRole("button", { name: "조직 설정 저장" })
    ).closest("section") as HTMLElement;

    const [clearRepos, clearMembers] = within(organizationSection).getAllByRole(
      "button",
      {
        name: "제외 목록 비우기",
      },
    );
    await user.click(clearRepos);

    expect(
      within(organizationSection).getByText("제외된 리포지토리: 0개", {
        selector: "span",
      }),
    ).toBeInTheDocument();
    expect(clearRepos).toBeDisabled();

    await user.click(clearMembers);

    expect(
      within(organizationSection).getByText("제외된 구성원: 0명", {
        selector: "span",
      }),
    ).toBeInTheDocument();
    expect(clearMembers).toBeDisabled();
  });

  it("updates personal settings independently", async () => {
    const user = userEvent.setup();
    mockFetchJsonOnce({ success: true });

    renderSettings();

    const timezoneSelect = screen.getByLabelText("표준 시간대");
    await user.selectOptions(timezoneSelect, "America/Los_Angeles");

    const formatSelect = screen.getByLabelText("날짜와 시간");
    await user.selectOptions(formatSelect, "en-us-12h");

    await user.click(screen.getByRole("button", { name: "개인 설정 저장" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain("/api/sync/config");
    expect(request.method).toBe("PATCH");
    expect(await request.clone().json()).toEqual({
      timezone: "America/Los_Angeles",
      weekStart: "monday",
      dateTimeFormat: "en-us-12h",
    });

    await waitFor(() => {
      expect(routerRefreshMock).toHaveBeenCalled();
    });

    expect(
      screen.getByText("설정이 저장되었습니다.", { selector: "p" }),
    ).toBeInTheDocument();
  });

  it("shows organization controls as read-only for non-admin users", async () => {
    const user = userEvent.setup();

    renderSettings({ isAdmin: false });

    await user.click(screen.getByRole("button", { name: "Organization" }));

    const organizationSection = (
      await screen.findByRole("button", { name: "조직 설정 저장" })
    ).closest("section") as HTMLElement;

    const orgInput =
      within(organizationSection).getByLabelText("Organization 이름");
    expect(orgInput).toBeDisabled();

    const intervalInput = within(organizationSection).getByLabelText(
      "자동 동기화 주기 (분)",
    );
    expect(intervalInput).toBeDisabled();

    const repoSelect =
      within(organizationSection).getByLabelText(
        /제외할 리포지토리를 선택하세요/,
      );
    expect(repoSelect).toBeDisabled();

    const memberSelect =
      within(organizationSection).getByLabelText(/제외할 구성원을 선택하세요/);
    expect(memberSelect).toBeDisabled();

    const saveButton = within(organizationSection).getByRole("button", {
      name: "조직 설정 저장",
    });
    expect(saveButton).toBeDisabled();
    expect(
      screen.getByText("관리자 권한이 있는 사용자만 수정할 수 있습니다."),
    ).toBeInTheDocument();
  });

  it("allows non-admin users to update personal settings only", async () => {
    const user = userEvent.setup();
    mockFetchJsonOnce({ success: true });

    renderSettings({ isAdmin: false });

    const timezoneSelect = screen.getByLabelText("표준 시간대");
    await user.selectOptions(timezoneSelect, "America/Los_Angeles");

    const formatSelect = screen.getByLabelText("날짜와 시간");
    await user.selectOptions(formatSelect, "dot-24h");

    await user.click(screen.getByRole("button", { name: "개인 설정 저장" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    const payload = await request.clone().json();
    expect(payload).toEqual({
      timezone: "America/Los_Angeles",
      weekStart: "monday",
      dateTimeFormat: "dot-24h",
    });

    await waitFor(() => {
      expect(routerRefreshMock).toHaveBeenCalled();
    });

    expect(
      screen.getByText("설정이 저장되었습니다.", { selector: "p" }),
    ).toBeInTheDocument();
  });
});
