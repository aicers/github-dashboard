// @vitest-environment jsdom

import "@testing-library/jest-dom";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MetricCard } from "@/components/dashboard/metric-card";

vi.mock("recharts", () => {
  const { createElement } = require("react") as typeof import("react");

  const createStub =
    (testId: string) =>
    ({ children }: { children?: import("react").ReactNode }) =>
      createElement("div", { "data-testid": testId }, children ?? null);

  const NullComponent = () => null;

  return {
    ResponsiveContainer: createStub("recharts-responsive"),
    LineChart: createStub("recharts-line-chart"),
    Line: NullComponent,
    XAxis: NullComponent,
    YAxis: NullComponent,
  };
});

describe("MetricCard", () => {
  it("renders override values, tooltip, and actions", () => {
    const metric = {
      current: 10,
      previous: 5,
      absoluteChange: 5,
      percentChange: 100,
    };

    render(
      <MetricCard
        title="PR 평균 크기"
        description="최근 기간과 비교한 평균 라인 수"
        metric={metric}
        format="count"
        tooltip="더 알아보기"
        actions={<button type="button">CSV 내보내기</button>}
        valueOverride="+10 / -5 라인"
      />,
    );

    const card = screen
      .getByText("PR 평균 크기")
      .closest('[data-slot="card"]') as HTMLElement;

    expect(
      within(card).getByText("최근 기간과 비교한 평균 라인 수"),
    ).toBeInTheDocument();
    expect(within(card).getByText("+10 / -5 라인")).toBeInTheDocument();
    const changeElement = within(card).getByText((_content, element) => {
      const text = element?.textContent?.trim();
      return text === "+5 (+100.0%)";
    });
    expect(changeElement).toHaveTextContent("+5 (+100.0%)");
    expect(
      within(card).getByRole("button", { name: "CSV 내보내기" }),
    ).toBeInTheDocument();

    const tooltipTrigger = within(card).getByRole("button", {
      name: "더 알아보기",
    });
    expect(tooltipTrigger).toHaveAttribute("aria-describedby");
    const tooltipId = tooltipTrigger.getAttribute("aria-describedby");
    expect(tooltipId).not.toBeNull();
    if (tooltipId) {
      expect(within(card).getByRole("tooltip")).toHaveAttribute(
        "id",
        tooltipId,
      );
    }
  });

  it("formats metric values and toggles history chart based on data", () => {
    const metric = {
      current: 1234,
      previous: 1000,
      absoluteChange: 234,
      percentChange: 23.4,
    };

    const { rerender } = render(
      <MetricCard
        title="활동 지표"
        metric={metric}
        format="count"
        history={[
          { period: "current", label: "현재", value: 42 },
          { period: "previous", label: "이전", value: 38 },
        ]}
      />,
    );

    const card = screen
      .getByText("활동 지표")
      .closest('[data-slot="card"]') as HTMLElement;

    expect(within(card).getByText("1,234")).toBeInTheDocument();
    const firstChange = within(card).getByText((_content, element) => {
      const text = element?.textContent?.trim();
      return text === "+234 (+23.4%)";
    });
    expect(firstChange).toHaveTextContent("+234 (+23.4%)");
    expect(within(card).getByTestId("recharts-responsive")).toBeInTheDocument();
    expect(within(card).getByTestId("recharts-line-chart")).toBeInTheDocument();

    rerender(
      <MetricCard
        title="활동 지표"
        metric={metric}
        format="count"
        history={[
          { period: "current", label: "현재", value: null },
          { period: "previous", label: "이전", value: null },
        ]}
      />,
    );

    expect(
      within(card).queryByTestId("recharts-responsive"),
    ).not.toBeInTheDocument();
  });
});
