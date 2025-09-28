import Link from "next/link";

import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-20 text-slate-100">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 mb-16 sm:mb-20">
        <span className="w-fit rounded-full border border-slate-700/70 bg-slate-900/80 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
          GitHub Control Room
        </span>
        <h1 className="text-balance text-4xl font-bold leading-tight sm:text-5xl">
          Keep every repository and team workflow moving from one hub.
        </h1>
        <p className="max-w-xl text-balance text-base text-slate-300 sm:text-lg">
          Dive into live contribution trends, unblock stalled work, and
          spotlight team wins without leaving this dashboard.
        </p>
        <div className="mt-2">
          <Button
            asChild
            size="lg"
            className="bg-blue-500 text-white shadow-lg shadow-blue-900/40 hover:bg-blue-400"
          >
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-3">
        {[
          {
            title: "Repository pulse",
            description:
              "Spot activity spikes, review progress, and recent contributions in seconds.",
          },
          {
            title: "Team workload",
            description:
              "Balance reviews and assignments so no pull request waits longer than it should.",
          },
          {
            title: "Delivery rhythm",
            description:
              "Track project momentum, celebrate wins, and keep outcomes visible for everyone.",
          },
        ].map(({ title, description }) => (
          <article
            key={title}
            className="flex flex-col gap-3 rounded-xl border border-slate-800/80 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40"
          >
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <p className="text-sm text-slate-300">{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
