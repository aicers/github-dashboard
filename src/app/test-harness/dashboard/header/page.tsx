import { DashboardHeader } from "@/components/dashboard/dashboard-header";

type HeaderHarnessPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function resolveParam(
  value: string | string[] | undefined,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }
  return Array.isArray(value) ? (value[0] ?? fallback) : value;
}

export default async function DashboardHeaderHarnessPage({
  searchParams,
}: HeaderHarnessPageProps) {
  const params = (await searchParams) ?? {};
  const userId = resolveParam(params.userId, "header-harness-user");
  const userName = resolveParam(params.name, "Header Harness User");
  const userLogin = resolveParam(params.login, "header-harness");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <DashboardHeader
        userId={userId}
        userName={userName}
        userLogin={userLogin}
        userAvatarUrl={null}
      />
    </main>
  );
}
