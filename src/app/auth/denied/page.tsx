import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Access Restricted",
};

export default function AuthDeniedPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center text-slate-100">
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold sm:text-4xl">
          Access limited to approved GitHub organization members
        </h1>
        <p className="text-base text-slate-300 sm:text-lg">
          Your GitHub account is not currently authorized for this dashboard.
          Make sure you are a member of the required organization and that you
          granted this application access inside GitHub under
          <span className="font-semibold">
            {" "}
            Settings → Applications → Authorized OAuth Apps
          </span>
          .
        </p>
        <p className="text-sm text-slate-400">
          Organization administrators may need to approve the app on your
          behalf. After the access is granted, sign in again through GitHub.
        </p>
      </div>

      <Button
        asChild
        size="lg"
        className="bg-blue-500 text-white hover:bg-blue-400"
      >
        <Link href="/auth/github">Try signing in again</Link>
      </Button>

      <Button variant="ghost" asChild>
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
