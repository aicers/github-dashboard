import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityView } from "@/components/dashboard/activity-view";
import { buildActivityFilterOptionsFixture } from "@/components/test-harness/activity-fixtures";
import type {
  ActivityListParams,
  ActivitySavedFilter,
} from "@/lib/activity/types";

import { buildActivityListParams } from "../../../tests/helpers/activity-filters";
import {
  buildActivityItem,
  buildActivityItemDetail,
  buildActivityListResult,
  buildActivityRepository,
  buildActivityUser,
  resetActivityHelperCounters,
} from "../../../tests/helpers/activity-items";
import {
  createJsonResponse,
  fetchMock,
  mockFetchJsonOnce,
  mockFetchOnce,
} from "../../../tests/setup/mock-fetch";

const mockRouter = {
  replace: vi.fn(),
  prefetch: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
};

const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

function createDefaultProps(overrides?: {
  initialData?: ReturnType<typeof buildActivityListResult>;
  initialParams?: ActivityListParams;
  currentUserId?: string | null;
}) {
  const user = buildActivityUser({ id: "user-1", login: "octocat" });
  const repository = buildActivityRepository({
    id: "repo-1",
    nameWithOwner: "acme/repo-one",
  });

  const initialData =
    overrides?.initialData ??
    buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-1",
          title: "첫번째 이슈",
          repository,
          author: user,
        }),
      ],
    });

  return {
    initialData,
    filterOptions: {
      repositories: [repository],
      labels: [],
      users: [user],
      issueTypes: [],
      milestones: [],
    },
    initialParams:
      overrides?.initialParams ??
      buildActivityListParams({
        page: 1,
        perPage: initialData.pageInfo.perPage,
      }),
    currentUserId:
      overrides?.currentUserId !== undefined
        ? overrides.currentUserId
        : user.id,
  };
}

beforeAll(() => {
  if (!globalThis.requestAnimationFrame) {
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0) as unknown as number,
    );
  }
  if (!globalThis.cancelAnimationFrame) {
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      clearTimeout(id as unknown as NodeJS.Timeout),
    );
  }
});

beforeEach(() => {
  resetActivityHelperCounters();
  mockRouter.replace.mockReset();
  mockRouter.prefetch.mockReset();
  mockRouter.push.mockReset();
  mockRouter.back.mockReset();
  mockRouter.forward.mockReset();
  mockRouter.refresh.mockReset();
});

describe("ActivityView", () => {
  it("applies quick filters, fetches new feed, and updates the URL query", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    const nextResult = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-quick",
          title: "주의 항목 이슈",
        }),
      ],
    });
    mockFetchJsonOnce(nextResult);

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const attentionButton = screen.getByRole("button", {
      name: "확인 필요",
    });
    fireEvent.click(attentionButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const request = fetchMock.mock.calls[1][0];
    expect(request.url).toContain("/api/activity?");

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());

    const lastReplace = mockRouter.replace.mock.calls.at(-1);
    expect(lastReplace).toBeTruthy();
    const [path, options] = lastReplace ?? [null, null];
    expect(options).toEqual({ scroll: false });
    expect(path?.startsWith("/dashboard/activity?")).toBe(true);

    const query = new URLSearchParams(path.split("?")[1]);
    expect(query.getAll("attention").length).toBeGreaterThanOrEqual(3);
    expect(query.getAll("attention")).toEqual(
      expect.arrayContaining([
        "issue_backlog",
        "review_requests_pending",
        "unanswered_mentions",
      ]),
    );
    expect(query.get("page")).toBeNull();

    await waitFor(() =>
      expect(screen.getByText("주의 항목 이슈")).toBeInTheDocument(),
    );

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("loads saved filters, applies the selected filter, and syncs controls", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    const savedFilter: ActivitySavedFilter = {
      id: "filter-issue",
      name: "Issues only",
      payload: buildActivityListParams({
        types: ["issue"],
        perPage: 10,
        statuses: ["open"],
      }),
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
    };

    mockFetchJsonOnce({ filters: [savedFilter], limit: 20 });

    const filteredResult = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-filtered",
          title: "필터 적용 이슈",
        }),
      ],
      pageInfo: { page: 1, perPage: 10, totalCount: 1, totalPages: 1 },
    });
    mockFetchJsonOnce(filteredResult);

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const select = screen.getByRole("option", { name: "필터 선택" })
      .parentElement as HTMLSelectElement;
    fireEvent.change(select, { target: { value: savedFilter.id } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(select.value).toBe(savedFilter.id);

    const lastReplace = mockRouter.replace.mock.calls.at(-1);
    expect(lastReplace).toBeTruthy();
    const [path, options] = lastReplace ?? [null, null];
    expect(options).toEqual({ scroll: false });
    expect(path).toBeTruthy();
    const params = new URLSearchParams((path ?? "").split("?")[1] ?? "");
    expect(params.getAll("category")).toEqual(["issue"]);
    expect(params.getAll("status")).toEqual(["open"]);
    expect(params.get("perPage")).toBe("10");

    const issueToggle = screen.getByRole("button", { name: "Issue" });
    expect(issueToggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "필터 적용" })).toBeDisabled();
    expect(screen.getByText("필터 적용 이슈")).toBeInTheDocument();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps the saved filter selector in sync with the current draft filters", async () => {
    const props = createDefaultProps();

    const basePayload = {
      types: ["issue"] as ActivityListParams["types"],
      perPage: 10,
      statuses: ["open"] as ActivityListParams["statuses"],
    };

    const savedFilter: ActivitySavedFilter = {
      id: "filter-issue",
      name: "Issues only",
      payload: buildActivityListParams(basePayload),
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
    };

    const secondarySearch = "review follow-up";

    const secondaryFilter: ActivitySavedFilter = {
      id: "filter-issue-search",
      name: "Issues with search",
      payload: buildActivityListParams({
        ...basePayload,
        search: secondarySearch,
      }),
      createdAt: "2024-02-02T00:00:00.000Z",
      updatedAt: "2024-02-02T00:00:00.000Z",
    };

    mockFetchJsonOnce({
      filters: [savedFilter, secondaryFilter],
      limit: 20,
    });

    const filteredResult = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-filtered",
          title: "필터 적용 이슈",
        }),
      ],
      pageInfo: { page: 1, perPage: 10, totalCount: 1, totalPages: 1 },
    });
    mockFetchJsonOnce(filteredResult);

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const select = screen.getByRole("option", { name: "필터 선택" })
      .parentElement as HTMLSelectElement;

    fireEvent.change(select, { target: { value: savedFilter.id } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(select.value).toBe(savedFilter.id));

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const searchInput = screen.getByPlaceholderText("제목, 본문, 코멘트 검색");

    fireEvent.change(searchInput, {
      target: { value: "non matching search" },
    });

    await waitFor(() => expect(select.value).toBe(""));

    fireEvent.change(searchInput, { target: { value: secondarySearch } });

    await waitFor(() => expect(select.value).toBe(secondaryFilter.id));
  });

  it("opens the detail drawer, loads item details, and restores scroll locking on close", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    const detailBody = "세부 내용 본문";
    mockFetchOnce({
      json: {
        item: buildActivityItem({ id: "activity-1", title: "첫번째 이슈" }),
        body: detailBody,
        bodyHtml: null,
        raw: {},
        parentIssues: [],
        subIssues: [],
      },
      delayMs: 10,
    });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const trigger = screen
      .getByText("첫번째 이슈")
      .closest("[role='button']") as HTMLElement;
    expect(trigger).toBeTruthy();

    const initialOverflow = document.body.style.overflow;
    fireEvent.click(trigger);

    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));

    await screen.findByText(detailBody);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const detailRequest = fetchMock.mock.calls[1][0];
    expect(detailRequest.url).toContain("/api/activity/activity-1");

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.body.style.overflow).toBe(initialOverflow ?? "");

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("shows an error when detail fetch fails and recovers on retry", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 5 });
    mockFetchOnce({
      status: 500,
      json: { message: "Failed to load detail" },
    });
    mockFetchJsonOnce(
      buildActivityItemDetail({
        item: buildActivityItem({ id: "activity-1", title: "첫번째 이슈" }),
        body: "Recovered detail body.",
      }),
    );

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /첫번째 이슈/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(consoleError).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /첫번째 이슈/ }));
    await screen.findByText("Recovered detail body.");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    consoleError.mockRestore();
  });

  it("shows a conflict notification when status updates are locked", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 5 });
    mockFetchJsonOnce(
      buildActivityItemDetail({
        item: buildActivityItem({
          id: "activity-1",
          title: "첫번째 이슈",
          issueProjectStatusLocked: true,
          issueTodoProjectStatus: "done",
        }),
      }),
    );
    mockFetchOnce({
      status: 409,
      json: {
        error: "Status managed by the to-do list project.",
        todoStatus: "done",
      },
    });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /첫번째 이슈/ }));
    const dialog = await screen.findByRole("dialog");

    within(dialog).getByRole("button", { name: "Done" }).click();
    await waitFor(() => expect(consoleError).toHaveBeenCalled());

    consoleError.mockRestore();
  });

  it("shows an error message when saving a filter fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps({
      initialParams: buildActivityListParams({
        repositoryIds: ["repo-1"],
      }),
    });

    mockFetchJsonOnce({ filters: [], limit: 5 });
    mockFetchOnce({
      status: 400,
      json: { message: "같은 이름의 필터가 이미 존재해요." },
    });
    mockFetchJsonOnce({ filters: [], limit: 5 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "현재 필터 저장" }));
    const manager = await screen.findByRole("dialog");
    const nameInput = within(manager).getByPlaceholderText("필터 이름");
    fireEvent.change(nameInput, { target: { value: "Duplicate filter" } });
    fireEvent.click(within(manager).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(nameInput).toHaveValue("Duplicate filter");
    expect(
      await within(manager).findByText("같은 이름의 필터가 이미 존재해요."),
    ).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("shows a feed error when activity fetch fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 5 });
    mockFetchOnce({ status: 500, json: { error: "Server error" } });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "확인 필요" }));

    await screen.findByText("활동 데이터를 불러오지 못했습니다.");

    consoleError.mockRestore();
  });

  it("saves the current filters and surfaces a success notification", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    const newlySaved: ActivitySavedFilter = {
      id: "filter-saved",
      name: "Issue focus",
      payload: buildActivityListParams({
        types: ["issue"],
        perPage: props.initialData.pageInfo.perPage,
      }),
      createdAt: "2024-02-03T00:00:00.000Z",
      updatedAt: "2024-02-03T00:00:00.000Z",
    };
    mockFetchJsonOnce({ filter: newlySaved, limit: 25 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Issue" }));

    fireEvent.click(screen.getByRole("button", { name: "현재 필터 저장" }));

    const manager = await screen.findByRole("dialog");
    const nameInput = within(manager).getByPlaceholderText("필터 이름");
    fireEvent.change(nameInput, { target: { value: newlySaved.name } });

    fireEvent.click(within(manager).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(newlySaved.id));

    expect(
      screen.getByRole("option", { name: newlySaved.name }),
    ).toBeInTheDocument();
    expect(screen.getByText("필터를 저장했어요.")).toBeInTheDocument();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("disables saving when the saved filter limit is reached", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    const savedFilters: ActivitySavedFilter[] = Array.from({ length: 2 }).map(
      (_, index) => ({
        id: `filter-${index + 1}`,
        name: `Saved filter ${index + 1}`,
        payload: buildActivityListParams({ repositoryIds: [`repo-${index}`] }),
        createdAt: `2024-02-${index + 10}T00:00:00.000Z`,
        updatedAt: `2024-02-${index + 10}T00:00:00.000Z`,
      }),
    );

    mockFetchJsonOnce({ filters: savedFilters, limit: savedFilters.length });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(
      screen.getByText(/최대 \d+개의 필터를 저장할 수 있어요/),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "현재 필터 저장" }),
    ).toBeDisabled();

    consoleError.mockRestore();
  });

  it("applies advanced filters with repository-scoped labels", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const filterOptions = buildActivityFilterOptionsFixture();

    const props = {
      ...createDefaultProps({
        initialParams: buildActivityListParams({
          labelKeys: ["bug", "feature"],
        }),
      }),
      filterOptions,
    };

    mockFetchJsonOnce({
      filters: [],
      limit: filterOptions.repositories.length,
    });

    const advancedResult = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-advanced",
          title: "고급 필터 적용 결과",
        }),
      ],
    });
    mockFetchJsonOnce(advancedResult);

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const repoInput = screen.getByPlaceholderText("저장소 선택");
    fireEvent.focus(repoInput);
    fireEvent.change(repoInput, { target: { value: "acme" } });
    fireEvent.keyDown(repoInput, { key: "Enter", code: "Enter", charCode: 13 });
    expect(screen.getByText("acme/alpha")).toBeInTheDocument();
    expect(screen.queryByText("feature")).not.toBeInTheDocument();

    const labelInput = screen.getByPlaceholderText("repo:label");
    fireEvent.focus(labelInput);
    fireEvent.change(labelInput, { target: { value: "bug" } });
    fireEvent.keyDown(labelInput, {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    await waitFor(() => expect(screen.getByText("bug")).toBeInTheDocument());
    expect(screen.queryByText("feature")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const request = fetchMock.mock.calls[1][0] as Request;
    const url = new URL(request.url);
    expect(url.searchParams.getAll("repositoryId")).toEqual(["repo-alpha"]);
    expect(url.searchParams.getAll("labelKey")).toEqual(["bug"]);

    await waitFor(() =>
      expect(screen.getByText("고급 필터 적용 결과")).toBeInTheDocument(),
    );

    consoleError.mockRestore();
  });

  it("paginates activity items and shows the empty state on later pages", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const initialData = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-initial",
          title: "Initial activity",
        }),
      ],
      pageInfo: { page: 1, perPage: 25, totalCount: 2, totalPages: 2 },
    });

    const props = createDefaultProps({ initialData });

    mockFetchJsonOnce({ filters: [], limit: 30 });

    const emptyResult = buildActivityListResult({
      items: [],
      pageInfo: { page: 2, perPage: 25, totalCount: 2, totalPages: 2 },
    });
    mockFetchJsonOnce(emptyResult);

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(screen.getByText("페이지 1 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이전" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다음" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const request = fetchMock.mock.calls[1][0] as Request;
    const url = new URL(request.url);
    expect(url.searchParams.get("page")).toBe("2");

    await waitFor(() =>
      expect(
        screen.getByText("필터 조건에 맞는 활동이 없습니다."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("페이지 2 / 2")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "이전" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const lastReplace = mockRouter.replace.mock.calls.at(-1);
    const [path] = lastReplace ?? [""];
    const params = new URLSearchParams((path ?? "").split("?")[1] ?? "");
    expect(params.get("page")).toBe("2");

    consoleError.mockRestore();
  });

  it("blocks saving when the payload matches a built-in quick filter", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "현재 필터 저장" }));
    const manager = await screen.findByRole("dialog");

    const nameInput = within(manager).getByPlaceholderText("필터 이름");
    fireEvent.change(nameInput, {
      target: { value: "Duplicate quick filter" },
    });

    fireEvent.click(within(manager).getByRole("button", { name: "저장" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(
      within(manager).getByText(
        "기본 빠른 필터와 동일한 설정은 저장할 수 없어요.",
      ),
    ).toBeInTheDocument();

    expect(nameInput).toHaveValue("Duplicate quick filter");

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("manages saved filters through rename, replace, and delete actions", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const existingPayload = buildActivityListParams({
      types: ["pull_request"],
      perPage: 25,
    });
    const existingFilter: ActivitySavedFilter = {
      id: "filter-manage",
      name: "Pull requests",
      payload: existingPayload,
      createdAt: "2024-02-10T00:00:00.000Z",
      updatedAt: "2024-02-10T00:00:00.000Z",
    };
    const renamedFilter: ActivitySavedFilter = {
      ...existingFilter,
      name: "Renamed filter",
      updatedAt: "2024-02-11T00:00:00.000Z",
    };
    const replacedPayload = buildActivityListParams({
      types: ["pull_request", "issue"],
      perPage: 25,
    });
    const replacedFilter: ActivitySavedFilter = {
      ...renamedFilter,
      payload: replacedPayload,
      updatedAt: "2024-02-12T00:00:00.000Z",
    };

    mockFetchJsonOnce({ filters: [existingFilter], limit: 30 });
    mockFetchJsonOnce({ filter: renamedFilter, limit: 30 });
    mockFetchJsonOnce({ filter: replacedFilter, limit: 30 });
    mockFetchJsonOnce({ filter: replacedFilter, limit: 30 });

    const props = createDefaultProps({
      initialParams: existingPayload,
    });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "필터 관리" }));

    const manager = screen.getByRole("dialog");
    const nameInput = within(manager).getByDisplayValue(existingFilter.name);
    fireEvent.change(nameInput, { target: { value: renamedFilter.name } });
    fireEvent.click(within(manager).getByRole("button", { name: "이름 저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await within(manager).findByText("필터 이름을 업데이트했어요.");
    expect(
      within(manager).getByDisplayValue(renamedFilter.name),
    ).toBeInTheDocument();
    expect(
      within(manager).queryByText("필터를 삭제했어요."),
    ).not.toBeInTheDocument();

    fireEvent.click(within(manager).getByRole("button", { name: "닫기" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Issue" }));

    fireEvent.click(screen.getByRole("button", { name: "필터 관리" }));
    const managerAfterToggle = screen.getByRole("dialog");
    expect(
      within(managerAfterToggle).queryByText("필터 이름을 업데이트했어요."),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(managerAfterToggle).getByRole("button", {
        name: "현재 필터로 업데이트",
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await within(managerAfterToggle).findByText(
      "필터 조건을 최신 설정으로 업데이트했어요.",
    );

    fireEvent.click(
      within(managerAfterToggle).getByRole("button", { name: "삭제" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await within(managerAfterToggle).findByText("필터를 삭제했어요.");
    expect(
      within(managerAfterToggle).getByText(/저장된 필터가 아직 없어요/),
    ).toBeInTheDocument();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("retries detail loading after an error and shows the eventual success", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });
    mockFetchOnce({
      status: 500,
      json: { message: "Detail failed" },
    });

    const detail = buildActivityItemDetail({
      item: props.initialData.items[0],
      body: "Detail body loaded",
    });

    let releaseDetail: (() => void) | null = null;
    mockFetchOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseDetail = resolve;
      });
      return createJsonResponse(detail);
    });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const trigger = screen
      .getByText("첫번째 이슈")
      .closest("[role='button']") as HTMLElement;
    fireEvent.click(trigger);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(consoleError).toHaveBeenCalled();
    await waitFor(() => expect(releaseDetail).not.toBeNull());

    expect(await screen.findByText("Loading details...")).toBeInTheDocument();

    await act(async () => {
      releaseDetail?.();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await screen.findByText("Detail body loaded");

    expect(
      screen.queryByText("선택한 항목의 내용을 불러오지 못했습니다."),
    ).not.toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("aborts the detail request when the drawer closes before completion", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    let aborted = false;
    mockFetchOnce((_request, signal) => {
      return new Promise<never>((_resolve, reject) => {
        if (signal?.aborted) {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const trigger = screen
      .getByText("첫번째 이슈")
      .closest("[role='button']") as HTMLElement;
    fireEvent.click(trigger);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(aborted).toBe(true));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("clears the notification message after the timer elapses", async () => {
    vi.useFakeTimers();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const props = createDefaultProps();

      mockFetchJsonOnce({ filters: [], limit: 30 });

      const newlySaved: ActivitySavedFilter = {
        id: "filter-saved",
        name: "Issue focus",
        payload: buildActivityListParams({
          types: ["issue"],
        }),
        createdAt: "2024-02-03T00:00:00.000Z",
        updatedAt: "2024-02-03T00:00:00.000Z",
      };
      mockFetchJsonOnce({ filter: newlySaved, limit: 30 });

      render(<ActivityView {...props} />);

      await act(async () => {});
      expect(fetchMock).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Issue" }));
      fireEvent.click(screen.getByRole("button", { name: "현재 필터 저장" }));

      await act(async () => {});
      const manager = screen.getByRole("dialog");

      fireEvent.change(within(manager).getByPlaceholderText("필터 이름"), {
        target: { value: newlySaved.name },
      });
      fireEvent.click(within(manager).getByRole("button", { name: "저장" }));

      await act(async () => {});
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      expect(screen.getByText("필터를 저장했어요.")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      await act(async () => {});

      expect(screen.queryByText("필터를 저장했어요.")).not.toBeInTheDocument();

      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      consoleError.mockRestore();
    }
  });

  it("invokes jump-to-date fetches with the normalized timestamp", async () => {
    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    const jumpResult = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "jumped",
          title: "Jump result",
        }),
      ],
      pageInfo: { page: 1, perPage: 25, totalCount: 1, totalPages: 1 },
    });

    mockFetchJsonOnce(jumpResult);

    render(<ActivityView {...props} />);

    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const dateInput =
      document.querySelector<HTMLInputElement>('input[type="date"]');
    expect(dateInput).not.toBeNull();

    const inputElement = dateInput as HTMLInputElement;
    fireEvent.change(inputElement, { target: { value: "2024-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "이동" }));

    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const request = fetchMock.mock.calls[1][0];
    const url = new URL(request.url);
    expect(url.pathname).toBe("/api/activity");

    const jumpTo = url.searchParams.get("jumpTo");
    expect(jumpTo).toBe("2024-04-01T00:00Z");

    expect(screen.getByText("Jump result")).toBeInTheDocument();
  });

  it("shows an error when saved filters fail to load", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchOnce({
      status: 500,
      json: { message: "boom" },
    });

    render(<ActivityView {...props} />);

    await act(async () => {});
    await act(async () => {});

    expect(
      screen.getByText("저장된 필터를 불러오지 못했어요."),
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
