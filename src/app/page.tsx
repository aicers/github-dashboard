import { Github } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main
      className="flex items-center justify-center min-h-screen"
      style={{
        background:
          "linear-gradient(148.304deg, rgb(248, 250, 252) 0%, rgb(255, 255, 255) 50%, rgb(241, 245, 249) 100%)",
      }}
    >
      <div className="relative w-[672px] h-[317px]">
        {/* Icon Container */}
        <div className="absolute left-1/2 top-0 flex h-[88px] w-[88px] -translate-x-1/2 items-center justify-center">
          <Image
            src="/entrance-icon.svg"
            alt="GitHub Dashboard icon"
            width={88}
            height={88}
            className="h-auto w-full"
            priority
          />
        </div>

        {/* Content Container */}
        <div className="absolute left-0 top-[88px] w-[672px] h-[105px]">
          {/* Main Title */}
          <div className="absolute left-0 top-0 w-[672px] h-[61px]">
            <h1 className="absolute left-1/2 top-0 transform -translate-x-1/2 font-bold text-[42px] leading-[46px] text-[#0f172b] text-center whitespace-nowrap tracking-[0.3px]">
              GitHub Dashboard
            </h1>
          </div>

          {/* Subtitle */}
          <div className="absolute left-12 top-[77px] w-[576px] h-7">
            <p className="absolute left-1/2 top-0 transform -translate-x-1/2 font-normal text-lg leading-7 text-[#62748e] text-center whitespace-nowrap tracking-[-0.44px]">
              Keep every repository and team workflow moving from one hub.
            </p>
          </div>
        </div>

        {/* Sign In Button */}
        <div className="absolute left-[225px] top-[248px] w-[221px] h-[56px]">
          <Button
            asChild
            className="w-full h-full bg-gradient-to-r from-[#9810fa] to-[#155dfc] hover:from-[#8a0ee8] hover:to-[#1350e8] text-white text-base font-medium shadow-[0px_10px_15px_-3px_rgba(173,70,255,0.25),0px_4px_6px_-4px_rgba(173,70,255,0.25)] rounded-lg border-0"
          >
            <Link
              href="/auth/github?next=/dashboard/activity"
              className="flex items-center gap-4"
            >
              <Github className="w-4 h-4" />
              Sign in with GitHub
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
