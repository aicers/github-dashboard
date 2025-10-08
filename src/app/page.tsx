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
        <p className="max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
          이 대시보드는 GitHub 계정으로 인증한 뒤 접근할 수 있으며, 사전에
          허용된 GitHub 조직의 구성원만 이용할 수 있습니다.
        </p>
        <p className="max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
          조직 외부 사용자는 안내 페이지로 이동합니다.
        </p>
        <div className="rounded-lg border border-slate-800/70 bg-slate-900/70 p-4 text-left text-sm text-slate-300">
          <p className="font-semibold text-slate-200">이용 전 확인하세요:</p>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              처음 로그인할 때 GitHub 승인 화면에서{" "}
              <span className="font-semibold">Authorize</span>를 누르고, 아래에
              표시되는{" "}
              <span className="font-semibold">Organization access</span>{" "}
              섹션에서도 <span className="font-semibold">Grant access</span>를
              눌러 주세요.
            </li>
            <li>
              승인 화면을 놓쳤다면{" "}
              <span className="font-semibold">
                GitHub {"→"} Settings → Applications → Authorized OAuth Apps
              </span>
              에서 해당 앱을 선택해 Grant 버튼을 눌러주세요.
            </li>
            <li>
              허용된 조직 구성원이 아니라면 대시보드에 접근할 수 없습니다.
            </li>
          </ul>
        </div>
        <div className="mt-2">
          <Button
            asChild
            size="lg"
            className="bg-blue-500 text-white shadow-lg shadow-blue-900/40 hover:bg-blue-400"
          >
            <Link href="/auth/github?next=/dashboard">GitHub으로 로그인</Link>
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
