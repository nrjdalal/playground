import { DashboardAside } from "@/components/dashboard/dashboard-aside"

// Every dashboard page beside the aside window, drawn once here, so its sizes and its picked tab hold from page to page.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardAside>{children}</DashboardAside>
}
