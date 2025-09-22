"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { RepositorySummary } from "@/lib/github";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  owner: z.string().min(1, "Owner (user or organization) is required."),
  name: z.string().min(1, "Repository name is required."),
});

export type RepositorySearchValues = z.infer<typeof searchSchema>;

export function RepositorySearchCard({ className }: { className?: string }) {
  const [result, setResult] = useState<RepositorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<RepositorySearchValues>({
    resolver: zodResolver(searchSchema),
    defaultValues: { owner: "vercel", name: "next.js" },
  });

  async function fetchRepository(values: RepositorySearchValues) {
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/github/repository", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? "Failed to fetch repository data.");
      }

      const payload = (await response.json()) as {
        repository: RepositorySummary;
      };
      setResult(payload.repository);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Unexpected error while fetching repository data.");
      }
    }
  }

  function onSubmit(values: RepositorySearchValues) {
    startTransition(() => {
      void fetchRepository(values);
    });
  }

  return (
    <Card className={cn("border-border/60 bg-background/70", className)}>
      <CardHeader>
        <CardTitle>Repository Lookup</CardTitle>
        <CardDescription>
          Validate API access by fetching a repository summary from GitHub.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="owner"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner (user or organization)</FormLabel>
                  <FormControl>
                    <Input placeholder="vercel" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repository</FormLabel>
                  <FormControl>
                    <Input placeholder="next.js" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? "Fetching…" : "Run Test"}
            </Button>
          </form>
        </Form>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        {result && (
          <div className="mt-6 space-y-2 text-sm">
            <p>
              <span className="font-semibold">Name:</span> {result.name}
            </p>
            {result.description && (
              <p>
                <span className="font-semibold">Description:</span>{" "}
                {result.description}
              </p>
            )}
            <p>
              <span className="font-semibold">Stars:</span>{" "}
              {result.stars.toLocaleString()}
            </p>
            <p>
              <span className="font-semibold">Forks:</span>{" "}
              {result.forks.toLocaleString()}
            </p>
            <p>
              <span className="font-semibold">Open issues:</span>{" "}
              {result.openIssues}
            </p>
            <p>
              <span className="font-semibold">Open PRs:</span>{" "}
              {result.openPullRequests}
            </p>
            <p>
              <span className="font-semibold">Default branch:</span>{" "}
              {result.defaultBranch}
            </p>
            <p>
              <span className="font-semibold">Last updated:</span>{" "}
              {new Date(result.updatedAt).toLocaleString()}
            </p>
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        {result && (
          <Button asChild variant="outline">
            <a href={result.url} rel="noreferrer" target="_blank">
              View on GitHub
            </a>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
