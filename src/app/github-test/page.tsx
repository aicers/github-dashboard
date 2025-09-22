import Link from "next/link";

import { RepositorySearchCard } from "@/components/github/repository-search";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchViewerSummary } from "@/lib/github";

export const dynamic = "force-dynamic";

export default async function GitHubTestPage() {
  const status: {
    error: string | null;
    viewer: Awaited<ReturnType<typeof fetchViewerSummary>> | null;
  } = {
    error: null,
    viewer: null,
  };

  try {
    status.viewer = await fetchViewerSummary();
  } catch (error) {
    status.error =
      error instanceof Error
        ? error.message
        : "Failed to connect to the GitHub API. Ensure GITHUB_TOKEN is configured.";
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-10 px-6 py-16">
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold sm:text-4xl">
          GitHub API Connectivity Test
        </h1>
        <p className="text-base text-muted-foreground sm:text-lg">
          Verify GitHub access using a personal access token with the GraphQL
          API. You can manage tokens in your GitHub account settings under{" "}
          <Link
            className="underline"
            href="https://github.com/settings/tokens"
            target="_blank"
          >
            Developer settings → Tokens (classic)
          </Link>
          .
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <RepositorySearchCard />

        <Card className="border-border/60 bg-background/70">
          <CardHeader>
            <CardTitle>Current Token Status</CardTitle>
            <CardDescription>
              Uses the viewer query to confirm the token grants access to the
              GitHub GraphQL API.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status.viewer ? (
              <div className="space-y-3 text-sm">
                <p>
                  <span className="font-semibold">Login:</span>{" "}
                  {status.viewer.login}
                </p>
                {status.viewer.name && (
                  <p>
                    <span className="font-semibold">Name:</span>{" "}
                    {status.viewer.name}
                  </p>
                )}
                <p>
                  <span className="font-semibold">Profile:</span>{" "}
                  <a
                    className="underline"
                    href={status.viewer.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {status.viewer.url}
                  </a>
                </p>
                <p>
                  <span className="font-semibold">Remaining requests:</span>{" "}
                  {status.viewer.remainingRequests}
                </p>
                <p>
                  <span className="font-semibold">Rate limit resets:</span>{" "}
                  {new Date(status.viewer.resetAt).toLocaleString()}
                </p>
              </div>
            ) : (
              <p className="text-sm text-destructive">
                {status.error ??
                  "Unable to connect to GitHub. Double-check your token configuration."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
