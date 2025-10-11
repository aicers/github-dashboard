import { Bell, LayoutGrid } from "lucide-react";

import { cn } from "@/lib/utils";

function buildInitials(userId: string | null | undefined) {
  if (!userId) {
    return "JD";
  }

  const parts = userId
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return userId.slice(0, 2).toUpperCase() || "JD";
  }

  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials.toUpperCase();
}

type DashboardHeaderProps = {
  userId?: string | null;
  notificationCount?: number;
};

export function DashboardHeader({
  userId,
  notificationCount = 3,
}: DashboardHeaderProps) {
  const initials = buildInitials(userId);

  return (
    <header className="flex flex-col gap-4 rounded-2xl bg-white/80 p-6 shadow-[0px_12px_30px_-12px_rgba(88,28,135,0.35)] ring-1 ring-black/5 backdrop-blur">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-[#ad46ff] to-[#7047ff] text-white shadow-[0px_10px_25px_rgba(138,43,226,0.25)]">
            <LayoutGrid className="size-6" strokeWidth={1.8} />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              GitHub Dashboard
            </h1>
            <p className="text-sm text-slate-500">
              Your Team Activity &amp; Insights Hub
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="알림"
            className="relative flex size-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-[0px_8px_20px_rgba(37,0,105,0.15)] ring-1 ring-black/5 transition hover:translate-y-[-1px] hover:shadow-[0px_12px_28px_rgba(37,0,105,0.18)]"
          >
            <Bell className="size-5" strokeWidth={1.8} />
            {notificationCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border-2 border-white bg-[#fb2c36] text-[10px] font-semibold leading-none text-white">
                {Math.min(notificationCount, 9)}
              </span>
            ) : null}
          </button>
          <div className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-[#5f3bff] to-[#8e52ff] text-sm font-semibold uppercase tracking-wide text-white shadow-[0px_10px_20px_rgba(88,28,135,0.2)]">
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
}

export function DashboardHeaderPlaceholder({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-28 rounded-2xl bg-white/60 ring-1 ring-black/5 backdrop-blur",
        className,
      )}
    />
  );
}
