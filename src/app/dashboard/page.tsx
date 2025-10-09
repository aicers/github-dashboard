import type { Route } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const activityRoute = "/dashboard/activity" as Route;
  redirect(activityRoute);
}
