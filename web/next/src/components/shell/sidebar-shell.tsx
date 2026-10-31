import { site } from "@packages/config/site"
import { cn } from "cn"
import { cookies } from "next/headers"

import { BrandLink } from "@/components/shell/brand-link"
import { SidebarAdaptive } from "@/components/shell/sidebar-adaptive"
import { SidebarFloatingTrigger } from "@/components/shell/sidebar-floating-trigger"
import { SidebarToggleRail } from "@/components/shell/sidebar-toggle-rail"
import { Badge } from "@/components/ui/badge"
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
} from "@/components/ui/sidebar"

// Shared collapsible sidebar shell used by the dashboard and console layouts. Owns the sidebar chrome (provider, header brand, footer, rail) and the persisted open state; callers supply the badge, the stats and a mark on the title's row (hidden with it on the rail), nav, and footer. The rail and Cmd+B toggle the sidebar, so the row holds no toggle.
export async function SidebarShell({
  badge,
  homeHref = "/dashboard",
  header,
  mark,
  opensPreview,
  stats,
  nav,
  footer,
  children,
}: {
  badge?: string
  homeHref?: string
  header?: React.ReactNode
  mark?: React.ReactNode
  opensPreview?: boolean
  stats?: React.ReactNode
  nav?: React.ReactNode
  footer: React.ReactNode
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const sidebarStateCookie = cookieStore.get("sidebar_state")?.value
  const defaultOpen = sidebarStateCookie ? sidebarStateCookie === "true" : true

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <SidebarAdaptive>
        <SidebarHeader>
          <div className="@container group-data-[collapsible=icon]:hidden">
            {/* the stats sit between the title and the mark only while the row shows no badge and is 238px or more, the room measured for the title, all four readings with disk at orange and GitHub, 4px apart, so a reading landing never moves the rows below; else they take a centred line of their own under the row */}
            <div
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 gap-y-2",
                stats &&
                  "@min-[238px]:[&:not(:has([data-slot=badge]))]:grid-cols-[minmax(0,1fr)_auto_auto]",
              )}
            >
              <BrandLink
                href={homeHref}
                opensPreview={opensPreview}
                className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 py-2 pr-1 pl-1.5 font-bold"
              >
                <span className={badge ? "shrink-0" : "min-w-0 truncate"}>{site.name}</span>
                {badge && (
                  <Badge variant="secondary" className="min-w-0 shrink justify-start text-xs">
                    <span className="truncate">{badge}</span>
                  </Badge>
                )}
              </BrandLink>
              {stats && (
                <div
                  className={cn(
                    "col-span-2 row-start-2 empty:hidden",
                    "@min-[238px]:[:not(:has([data-slot=badge]))>&]:col-span-1 @min-[238px]:[:not(:has([data-slot=badge]))>&]:col-start-2 @min-[238px]:[:not(:has([data-slot=badge]))>&]:row-start-1",
                  )}
                >
                  {stats}
                </div>
              )}
              {mark && (
                <div
                  className={cn(
                    "col-start-2 row-start-1 empty:hidden",
                    stats && "@min-[238px]:[:not(:has([data-slot=badge]))>&]:col-start-3",
                  )}
                >
                  {mark}
                </div>
              )}
            </div>
          </div>
          {header}
        </SidebarHeader>
        <SidebarContent>{nav}</SidebarContent>
        <SidebarFooter>{footer}</SidebarFooter>
        <SidebarToggleRail />
      </SidebarAdaptive>
      <main className="flex min-h-svh min-w-0 flex-1 flex-col">
        <SidebarFloatingTrigger />
        {children}
      </main>
    </SidebarProvider>
  )
}
