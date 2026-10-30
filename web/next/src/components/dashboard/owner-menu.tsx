"use client"

import { RiHistoryLine, RiPushpinLine } from "@remixicon/react"
import { cn } from "cn"
import { createContext, type ReactNode, useContext } from "react"

import { useDashboardUpdate } from "@/components/dashboard/app-sidebar"
import { useDashboard } from "@/components/dashboard/dashboard"
import { getInitials, UserMenuItems } from "@/components/shell/sidebar-user-menu"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { APP_SQUARE } from "@/lib/apps"
import { BAR_ITEM, GLASS } from "@/lib/floating-bar"
import { sessionsMenuLinks } from "@/lib/sessions"

type OwnerMenuValue = { canAccessConsole: boolean; machine: string }

const OwnerMenu = createContext<OwnerMenuValue | null>(null)

// The layout's word on who is signed in, for the aside toolbar's menu square, since the aside renders under the dashboard's own layout.
export function OwnerMenuProvider({
  children,
  ...value
}: OwnerMenuValue & { children: ReactNode }) {
  return <OwnerMenu.Provider value={value}>{children}</OwnerMenu.Provider>
}

// The user menu, moved from the sidebar's footer to the aside toolbar's end: a square with this Mac's initials, a green dot while an update waits, opening the same items upward on the toolbar's glass, the tab bar's Auto-hide setting at its top on a wide screen.
export function AsideUserMenu({
  autoHide,
  onAutoHide,
}: {
  autoHide?: boolean
  onAutoHide?: (on: boolean) => void
}) {
  const value = useContext(OwnerMenu)
  const { allowed } = useDashboard()
  const update = useDashboardUpdate()
  if (!value) return null
  const links = sessionsMenuLinks(allowed).map((link) => ({ ...link, icon: <RiHistoryLine /> }))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={update ? `Your menu, update available: ${update.hover}` : "Your menu"}
            className={cn(APP_SQUARE, BAR_ITEM, "relative flex-none")}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <span className="bg-muted text-muted-foreground text-2xs grid size-5 place-items-center rounded-sm font-medium">
          {getInitials(value.machine)}
        </span>
        {update && (
          <span aria-hidden className="bg-success absolute top-1 right-1 size-1.5 rounded-full" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" sideOffset={8} className={cn(GLASS, "w-56")}>
        {onAutoHide && (
          <>
            <DropdownMenuCheckboxItem checked={autoHide} onCheckedChange={onAutoHide}>
              <RiPushpinLine />
              Auto-hide tab bar
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        )}
        <UserMenuItems
          area={value.canAccessConsole ? "dashboard" : undefined}
          links={links}
          logOut={false}
          update={update}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
