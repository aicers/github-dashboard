"use client";

import { Fragment } from "react";

import type { HeatmapCell } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

type ActivityHeatmapProps = {
  data: HeatmapCell[];
  valueLabel?: string;
  className?: string;
};

export function ActivityHeatmap({
  data,
  valueLabel = "활동",
  className,
}: ActivityHeatmapProps) {
  const max = data.reduce((acc, cell) => Math.max(acc, cell.count), 0);
  const cells = new Map<string, number>();
  data.forEach((cell) => {
    cells.set(`${cell.day}-${cell.hour}`, cell.count);
  });

  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const dayIndices = Array.from({ length: 7 }, (_, day) => day);
  const suffix = valueLabel.trim().length ? ` ${valueLabel}` : "";

  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[80px_repeat(24,minmax(16px,1fr))] gap-[3px]">
          <div />
          {hours.map((hour) => (
            <div
              key={`hour-${hour}`}
              className="text-center text-[10px] text-muted-foreground"
            >
              {hour}
            </div>
          ))}
          {dayIndices.map((dayIndex) => (
            <Fragment key={`day-${dayIndex}`}>
              <div className="flex items-center justify-end pr-2 text-xs text-muted-foreground">
                {days[dayIndex]}
              </div>
              {hours.map((hour) => {
                const key = `${dayIndex}-${hour}`;
                const count = cells.get(key) ?? 0;
                const intensity = max === 0 ? 0 : count / max;
                const background = `rgba(59, 130, 246, ${Math.max(intensity * 0.85, 0.05)})`;
                return (
                  <div
                    key={`cell-${key}`}
                    className="h-[18px] rounded-sm"
                    style={{
                      backgroundColor: intensity === 0 ? "#F3F4F6" : background,
                    }}
                    title={`${days[dayIndex]} ${hour}시: ${count.toLocaleString()}${suffix}`.trim()}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
