import { loadEnvConfig } from "@next/env";

type CliOptions = {
  repositoryNames: string[];
  since: string | null;
  until: string | null;
};

function parseArgs(): CliOptions {
  const repositoryNames: string[] = [];
  let since: string | null = null;
  let until: string | null = null;

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--repo") {
      const value = args[index + 1];
      if (typeof value === "string" && value.trim().length > 0) {
        repositoryNames.push(value.trim());
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--repo=")) {
      const value = arg.slice("--repo=".length).trim();
      if (value.length > 0) {
        repositoryNames.push(value);
      }
      continue;
    }
    if (arg.startsWith("--since=")) {
      const value = arg.slice("--since=".length).trim();
      since = value.length > 0 ? value : null;
      continue;
    }
    if (arg.startsWith("--until=")) {
      const value = arg.slice("--until=".length).trim();
      until = value.length > 0 ? value : null;
    }
  }

  return { repositoryNames, since, until };
}

async function main() {
  loadEnvConfig(process.cwd());

  const [dbModule, envModule, collectorsModule] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/env"),
    import("@/lib/github/collectors"),
  ]);
  const { ensureSchema, closePool } = dbModule;
  const { env } = envModule;
  const { collectDiscussionsOnly } = collectorsModule;

  await ensureSchema();

  const org = env.GITHUB_ORG ?? null;
  if (!org) {
    throw new Error(
      "GITHUB_ORG가 설정되어 있지 않습니다. 환경변수에 조직 이름을 지정해 주세요.",
    );
  }

  if (!env.GITHUB_TOKEN || env.GITHUB_TOKEN.length === 0) {
    throw new Error(
      "GITHUB_TOKEN이 설정되어 있지 않습니다. GitHub GraphQL API 호출을 위해 토큰이 필요합니다.",
    );
  }

  const { repositoryNames, since, until } = parseArgs();
  console.info(
    `[discussions] 시작 – org: ${org}, repo count: ${repositoryNames.length || "all"}, since: ${since ?? "none"}, until: ${until ?? "none"}`,
  );

  const summary = await collectDiscussionsOnly({
    org,
    since,
    until,
    logger: (message) => console.info(`[github] ${message}`),
    repositoryNames,
  });

  console.info(
    `[discussions] 완료 – repositories: ${summary.repositoriesProcessed}, discussions: ${summary.discussionCount}, comments: ${summary.commentCount}`,
  );
  if (summary.latestDiscussionUpdated) {
    console.info(
      `[discussions] latest discussion updated at ${summary.latestDiscussionUpdated}`,
    );
  }
  if (summary.latestCommentUpdated) {
    console.info(
      `[discussions] latest comment updated at ${summary.latestCommentUpdated}`,
    );
  }

  await closePool();
}

main().catch((error) => {
  console.error("[discussions] 실패", error);
  import("@/lib/db")
    .then(({ closePool }) =>
      closePool().catch((closeError) => {
        console.error(
          "[discussions] 데이터베이스 연결 종료 중 오류",
          closeError,
        );
      }),
    )
    .finally(() => {
      process.exit(1);
    });
});
