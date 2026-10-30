"use client"

import { cn } from "cn"
import { usePathname } from "next/navigation"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { isDocsPath } from "@/lib/docs"

// Shared floating sidebar trigger. In the docs area the sidebar is offcanvas, so on desktop this becomes an edge tab; elsewhere the sidebar's rail and Cmd+B cover desktop and this stays hidden. On mobile it's a labeled button bottom-right, but on the dashboard, whose phone tab bar holds Menu as its last square; always puts it back where the dashboard draws no bar (below the owner rung). Label: "Docs" in docs, "Menu" elsewhere.
export function SidebarFloatingTrigger({ always = false }: { always?: boolean }) {
  const pathname = usePathname()
  const isDocs = isDocsPath(pathname)
  if (!always && pathname.startsWith("/dashboard")) return null

  return (
    <SidebarTrigger
      variant="secondary"
      size="default"
      className={cn(
        "bg-sidebar fixed right-0 bottom-0 z-20 mr-6 mb-16 h-8 border",
        isDocs ? "md:right-auto md:mb-48 md:size-7 md:rounded-l-none md:border-l-0" : "md:hidden",
      )}
    >
      <span className={cn(isDocs && "md:hidden")}>{isDocs ? "Docs" : "Menu"}</span>
    </SidebarTrigger>
  )
}
