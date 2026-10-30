"use client"

import { Hint } from "@/components/hint"
import { SidebarRail, useSidebar } from "@/components/ui/sidebar"

// The rail with its tooltip. The toggle is passed to the rail element itself, since Hint's trigger hands the rail Base UI's own onClick, which SidebarRail spreads over its built-in toggle (the rail once toggled nothing).
export function SidebarToggleRail() {
  const { toggleSidebar } = useSidebar()
  return (
    <Hint content="Toggle Sidebar" side="right">
      <SidebarRail onClick={toggleSidebar} />
    </Hint>
  )
}
