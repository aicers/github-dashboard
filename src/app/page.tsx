import Link from "next/link";

import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col gap-12 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 py-16 text-slate-100">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 text-center">
        <span className="rounded-full border border-slate-700/60 bg-slate-900/60 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          GitHub Dashboard
        </span>
        <h1 className="text-balance text-4xl font-bold leading-tight sm:text-5xl">
          Monitor GitHub activity, insights, and workflows from a single
          dashboard.
        </h1>
        <p className="text-balance text-base text-slate-300 sm:text-lg">
          This project scaffolds a modern Next.js app with Tailwind CSS,
          shadcn/ui, typed forms, and testing. Use it as the foundation for
          building compelling GitHub experiences.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/dashboard">Open the data dashboard</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/github-test">Open the GitHub test page</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-3">
        {[
          {
            title: "Live GitHub data",
            description:
              "Fetch and display organization or repository insights with the GitHub API.",
          },
          {
            title: "Polished UI",
            description:
              "Tailwind CSS plus shadcn/ui components offer a consistent, accessible design system.",
          },
          {
            title: "Ready to ship",
            description:
              "Typed forms, Vitest, Docker, and CI ensure the app is production-ready from day one.",
          },
        ].map(({ title, description }) => (
          <article
            key={title}
            className="flex flex-col gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-6 shadow-lg shadow-slate-950/50"
          >
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <p className="text-sm text-slate-300">{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
