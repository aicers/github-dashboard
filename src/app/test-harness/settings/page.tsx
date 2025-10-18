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
      />
      <p className="text-sm text-muted-foreground">
        Query with <code>?admin=false</code> to preview the non-admin read-only
        state.
      </p>
    </main>
  );
}
