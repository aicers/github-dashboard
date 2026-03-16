import type { ReactNode } from "react";

import { assertDebugSurfaceEnabled } from "@/lib/debug-surface";

export default function TestHarnessLayout({
  children,
}: {
  children: ReactNode;
}) {
  assertDebugSurfaceEnabled();
  return children;
}
