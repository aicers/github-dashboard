import type { Route } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const analyticsRoute = "/dashboard/analytics" as Route;
  redirect(analyticsRoute);
}
