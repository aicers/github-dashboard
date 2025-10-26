import { SettingsView } from "@/components/dashboard/settings-view";
import type { RepositoryProfile, UserProfile } from "@/lib/db/operations";

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

const holidayCalendars = [
  {
    code: "kr" as const,
    label: "한국",
    countryLabel: "한국",
    regionLabel: null,
    sortOrder: 1,
    holidayCount: 2,
  },
  {
    code: "jp" as const,
    label: "일본",
    countryLabel: "일본",
    regionLabel: null,
    sortOrder: 2,
    holidayCount: 0,
  },
];

const holidayEntries = [
  {
    id: 1,
    calendarCode: "kr" as const,
    year: 2025,
    dateKey: "01-01",
    holidayDate: "2025-01-01",
    weekday: "수",
    name: "신정",
    note: null,
  },
  {
    id: 2,
    calendarCode: "kr" as const,
    year: 2025,
    dateKey: "02-28",
    holidayDate: "2025-02-28",
    weekday: "금",
    name: "샘플 공휴일",
    note: "테스트용",
  },
];

function resolveIsAdmin(searchParams?: { admin?: string }) {
  const value = searchParams?.admin;
  if (!value) {
    return true;
  }

  return ["true", "1", "yes"].includes(value.toLowerCase());
}

export default async function SettingsHarnessPage({
  searchParams,
}: {
  searchParams?: Promise<{ admin?: string }>;
}) {
  const resolvedParams = await searchParams;
  const isAdmin = resolveIsAdmin(resolvedParams);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <SettingsView
        orgName="acme"
        syncIntervalMinutes={30}
        timeZone="Asia/Seoul"
        weekStart="monday"
        dateTimeFormat="auto"
        personalHolidayCalendarCodes={["kr"]}
        organizationHolidayCalendarCodes={["kr"]}
        holidayPreviewCalendarCode="kr"
        holidayCalendars={holidayCalendars}
        initialPreviewHolidayEntries={holidayEntries}
        personalHolidays={[]}
        repositories={repositories}
        excludedRepositoryIds={["repo-2"]}
        members={members}
        excludedMemberIds={["user-3"]}
        allowedTeamSlugs={["core-team"]}
        allowedUserIds={["MDQ6VXNlcjEwMA=="]}
        organizationTeams={organizationTeams}
        organizationMembers={organizationMembers}
        isAdmin={isAdmin}
        currentUserId="user-1"
        currentUserName="Octo Cat"
        currentUserLogin="octocat"
        currentUserAvatarUrl={null}
        currentUserOriginalAvatarUrl={"https://github.com/images/octocat.png"}
        currentUserCustomAvatarUrl={null}
        activityRowsPerPage={25}
      />
      <p className="text-sm text-muted-foreground">
        Query with <code>?admin=false</code> to preview the non-admin read-only
        state.
      </p>
    </main>
  );
}
