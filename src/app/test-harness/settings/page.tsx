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
        repositories={repositories}
        excludedRepositoryIds={["repo-2"]}
        members={members}
        excludedMemberIds={["user-3"]}
        isAdmin={isAdmin}
      />
      <p className="text-sm text-muted-foreground">
        Query with <code>?admin=false</code> to preview the non-admin read-only
        state.
      </p>
    </main>
  );
}
