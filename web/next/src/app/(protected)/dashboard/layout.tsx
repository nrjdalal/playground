import { cookies } from "next/headers"

import { SPLIT_COOKIE, storedSplit } from "@/components/dashboard/aside-split"
import { DashboardAside } from "@/components/dashboard/dashboard-aside"

// Every dashboard page beside the aside window, drawn once here, so its sizes and its picked tab hold from page to page; the split opens where the owner last let it go.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const split = storedSplit((await cookies()).get(SPLIT_COOKIE)?.value)
  return <DashboardAside split={split}>{children}</DashboardAside>
}
