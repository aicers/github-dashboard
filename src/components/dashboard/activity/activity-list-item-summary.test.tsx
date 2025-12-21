import type { IconProps } from "@primer/octicons-react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActivityListItemSummary } from "@/components/dashboard/activity/activity-list-item-summary";
import type { ActivityIconInfo } from "@/components/dashboard/activity/shared";

const DummyIcon = (_props: IconProps) => <svg data-testid="dummy-icon" />;

const iconInfo = {
  Icon: DummyIcon,
  className: "text-foreground",
  label: "Dummy",
} satisfies ActivityIconInfo;

describe("ActivityListItemSummary truncation layout", () => {
  it("applies min-width and flex classes so long titles truncate without breaking sibling layout", () => {
    const { container } = render(
      <div className="flex w-[520px] items-start justify-between gap-4">
        <ActivityListItemSummary
          iconInfo={iconInfo}
          referenceLabel="acme/repo#123"
          referenceUrl="https://example.com"
          title={
            "This is a very long title that should truncate before it pushes other columns out of alignment"
          }
        />
        <div className="w-[180px] shrink-0 text-right">4 days ago</div>
      </div>,
    );

    const titleSpan = container.querySelector("span.truncate");
    expect(titleSpan).toBeTruthy();
    expect(titleSpan).toHaveClass("min-w-0", "flex-1");

    const row = titleSpan?.parentElement;
    expect(row).toHaveClass("min-w-0");

    const root = row?.parentElement;
    expect(root).toHaveClass("min-w-0");
  });

  it("merges custom className onto the root container", () => {
    const { container } = render(
      <ActivityListItemSummary
        iconInfo={iconInfo}
        referenceLabel="acme/repo#1"
        title="Short title"
        className="sm:flex-1"
      />,
    );

    expect(container.firstElementChild).toHaveClass("sm:flex-1");
  });
});
