import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityView } from "@/components/dashboard/activity-view";
import {
  buildActivityFilterOptionsFixture,
  buildActivityItemFixture,
  buildActivityListResultFixture,
} from "@/components/test-harness/activity-fixtures";
import type { ActivityListParams } from "@/lib/activity/types";

import { buildActivityListParams } from "../../../tests/helpers/activity-filters";
import {
  buildActivityListResult,
  resetActivityHelperCounters,
} from "../../../tests/helpers/activity-items";
import {
  fetchMock,
  mockFetchJsonOnce,
  resetMockFetch,
  setDefaultFetchHandler,
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

function getLastActivityCall() {
  const calls = fetchMock.mock.calls;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const [request] = calls[index] ?? [];
    if (request instanceof Request && request.url.includes("/api/activity")) {
      return request;
    }
  }
  return null;
}

function createDefaultProps(overrides?: {
  initialData?: ReturnType<typeof buildActivityListResult>;
  initialParams?: ActivityListParams;
  currentUserId?: string | null;
}) {
  const initialData =
    overrides?.initialData ??
    buildActivityListResult({
      items: [
        buildActivityItemFixture({
          id: "activity-1",
          title: "첫번째 이슈",
        }),
      ],
    });

  return {
    initialData,
    filterOptions: buildActivityFilterOptionsFixture(),
    initialParams:
      overrides?.initialParams ?? buildActivityListParams({ page: 1 }),
    currentUserId: overrides?.currentUserId ?? "user-1",
  } satisfies React.ComponentProps<typeof ActivityView>;
}

describe("ActivityView", () => {
  beforeEach(() => {
    resetActivityHelperCounters();
    resetMockFetch();
    setDefaultFetchHandler({ json: {} });
    mockRouter.replace.mockReset();
  });

  it("renders initial items and pagination info", () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();
    render(<ActivityView {...props} />);

    expect(screen.getByText("첫번째 이슈")).toBeVisible();
    expect(screen.getByText(/페이지 1 \/ 1 \(총 1건\)/)).toBeVisible();
  });

  it("applies quick filter and fetches updated results", async () => {
    const initial = buildActivityListResult();
    const next = buildActivityListResultFixture({
      items: [
        buildActivityItemFixture({
          id: "activity-2",
          title: "주의 필요한 이슈",
        }),
      ],
    });

    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps({ initialData: initial });
    render(<ActivityView {...props} />);

    mockFetchJsonOnce(next);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^확인 필요$/ }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      expect(url.searchParams.getAll("attention").length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getByText("주의 필요한 이슈")).toBeVisible();
    });
  });

  it("requests jump-to-date navigation", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();
    render(<ActivityView {...props} />);

    mockFetchJsonOnce(
      buildActivityListResultFixture({
        items: [
          buildActivityItemFixture({
            id: "activity-3",
            title: "점프 이슈",
          }),
        ],
      }),
    );

    const input = screen.getByLabelText("날짜 이동");
    fireEvent.change(input, { target: { value: "2024-05-01" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "이동" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      expect(url.searchParams.get("jumpTo")).toMatch(/^2024-05-01/);
    });
  });

  it("changes page and fetches next results", async () => {
    const initial = buildActivityListResultFixture({
      items: [buildActivityItemFixture({ title: "첫번째" })],
      pageInfo: { page: 1, perPage: 1, totalCount: 2, totalPages: 2 },
    });
    const next = buildActivityListResultFixture({
      items: [buildActivityItemFixture({ title: "두번째" })],
      pageInfo: { page: 2, perPage: 1, totalCount: 2, totalPages: 2 },
    });

    mockFetchJsonOnce({ filters: [], limit: 5 });
    mockFetchJsonOnce(next);

    const props = createDefaultProps({ initialData: initial });
    render(<ActivityView {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다음" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      expect(url.searchParams.get("page")).toBe("2");
    });

    await waitFor(() => {
      expect(screen.getByText("두번째")).toBeVisible();
    });
  });
});
