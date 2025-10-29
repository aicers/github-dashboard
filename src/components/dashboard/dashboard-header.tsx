"use client";

import { Bell } from "lucide-react";
import type { Route } from "next";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ATTENTION_REQUIRED_VALUES } from "@/lib/activity/attention-options";
import { buildUserInitials } from "@/lib/user/initials";
import { cn } from "@/lib/utils";

type DashboardHeaderProps = {
  userId?: string | null;
  userName?: string | null;
  userLogin?: string | null;
  userAvatarUrl?: string | null;
};

const PEOPLE_QUERY_KEYS = [
  "authorId",
  "assigneeId",
  "reviewerId",
  "mentionedUserId",
  "commenterId",
  "reactorId",
] as const;

export function DashboardHeader({
  userId,
  userName,
  userLogin,
  userAvatarUrl,
}: DashboardHeaderProps) {
  const initials = buildUserInitials({
    name: userName,
    login: userLogin,
    fallback: userId,
  });
  const router = useRouter();
  const [notificationCount, setNotificationCount] = useState<number>(0);

  useEffect(() => {
    if (!userId) {
      setNotificationCount(0);
      return;
    }

    const controller = new AbortController();
    let isCancelled = false;

    const loadNotificationCount = async () => {
      try {
        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("perPage", "1");
        ATTENTION_REQUIRED_VALUES.forEach((value) => {
          params.append("attention", value);
        });
        PEOPLE_QUERY_KEYS.forEach((key) => {
          params.append(key, userId);
        });

        const response = await fetch(`/api/activity?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to load attention count");
        }

        const payload = (await response.json()) as {
          pageInfo?: { totalCount?: number };
        };
        const totalCount =
          typeof payload?.pageInfo?.totalCount === "number"
            ? payload.pageInfo.totalCount
            : 0;
        if (!isCancelled) {
          setNotificationCount(totalCount);
        }
      } catch (error) {
        if (isCancelled || (error as Error)?.name === "AbortError") {
          return;
        }
        console.error(error);
        setNotificationCount(0);
      }
    };

    void loadNotificationCount();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [userId]);

  const notificationsHref = useMemo(() => {
    if (!userId) {
      return "/dashboard/activity";
    }

    const params = new URLSearchParams();
    params.append("attention", "review_requests_pending");
    params.append("attention", "unanswered_mentions");
    params.append("reviewerId", userId);
    params.append("mentionedUserId", userId);
    params.append("peopleSelection", userId);

    return `/dashboard/activity?${params.toString()}`;
  }, [userId]);

  const notificationsRoute = notificationsHref as Route;

  useEffect(() => {
    try {
      router.prefetch(notificationsRoute);
    } catch {
      // ignore router prefetch errors
    }
  }, [notificationsRoute, router]);

  const effectiveCount = Math.max(notificationCount, 0);
  const displayCount =
    effectiveCount > 99 ? "99+" : effectiveCount.toLocaleString();
  const showBadge = effectiveCount > 0;
  const ariaLabel = showBadge
    ? `알림 (${effectiveCount.toLocaleString()}건)`
    : "알림";

  return (
    <header className="flex flex-col gap-2 pb-0.5">
      <div className="flex items-center justify-between gap-4 -mt-0.5">
        <div className="flex items-center gap-2.5 -ml-2 -translate-y-px transform">
          {/* biome-ignore lint/performance/noImgElement: Next Image clips the drop shadow for this SVG */}
          <img
            src="/entrance-icon.svg"
            alt="GitHub Dashboard icon"
            width={88}
            height={88}
            className="h-16 w-16 translate-y-1 transform"
            loading="lazy"
          />
          <div className="space-y-1 -translate-x-px -translate-y-0.5 transform">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              GitHub Dashboard
            </h1>
            <p className="text-sm text-slate-500">
              Your Team Activity &amp; Insights Hub
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 -translate-y-0.5 transform">
          <button
            type="button"
            aria-label={ariaLabel}
            className="relative flex size-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-[0px_8px_20px_rgba(37,0,105,0.15)] ring-1 ring-black/5 transition hover:-translate-y-px hover:shadow-[0px_12px_28px_rgba(37,0,105,0.18)]"
            onClick={() => {
              router.push(notificationsRoute);
            }}
          >
            <Bell className="size-5" strokeWidth={1.8} />
            {showBadge ? (
              <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-[#fb2c36] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {displayCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/settings")}
            className="group relative flex size-10 items-center justify-center rounded-full text-sm font-semibold uppercase tracking-wide text-white shadow-[0px_10px_20px_rgba(88,28,135,0.2)] ring-1 ring-black/5 transition hover:-translate-y-px hover:shadow-[0px_12px_28px_rgba(88,28,135,0.25)]"
            aria-label="프로필 설정 열기"
          >
            {userAvatarUrl ? (
              <Image
                src={userAvatarUrl}
                alt={userName ?? userLogin ?? initials}
                width={40}
                height={40}
                className="h-10 w-10 rounded-full object-cover"
                referrerPolicy="no-referrer"
                unoptimized
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center rounded-full bg-linear-to-br from-[#5f3bff] to-[#8e52ff]">
                {initials}
              </span>
            )}
          </button>
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
  return <div className={cn("h-28", className)} />;
}
