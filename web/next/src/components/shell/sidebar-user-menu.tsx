"use client"

import { env } from "@packages/env/web-next"
import {
  RiArrowRightSLine,
  RiBookOpenLine,
  RiDashboardLine,
  RiDownloadCloud2Line,
  RiLogoutBoxLine,
  RiMessage2Line,
  RiSettings3Line,
  RiTerminalBoxLine,
} from "@remixicon/react"
import { type User } from "better-auth/types"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type ReactNode, useState } from "react"

import { SidebarDropdownMenu } from "@/components/shell/sidebar-dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { SidebarMenuItem } from "@/components/ui/sidebar"
import { toast } from "@/components/ui/toast"
import { authClient } from "@/lib/auth/client"
import { accountLine, useAccount } from "@/lib/system"

export function getInitials(name: string) {
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export type UserMenuLink = { href: string; icon: ReactNode; label: string; onClick?: () => void }

// The menu's avatar and two lines: this Mac, named on the server so it paints whole, over its Claude account. The account line is plain text that holds its height while the first read is pending, so nothing moves when it lands.
export function userIdentity(machine: string, line: string | null) {
  return {
    leading: (
      <Avatar className="size-8 rounded-md after:hidden">
        <AvatarFallback className="rounded-md">{getInitials(machine)}</AvatarFallback>
      </Avatar>
    ),
    primary: machine,
    secondary: line ?? <span aria-busy="true">{"\u00a0"}</span>,
  }
}

// The menu's update, while this build is behind: its words for the hover, and what Update now does.
export type MenuUpdate = { hover: string; onUpdate: () => void }

// Shared sidebar user dropdown, the Console's (this Mac and its Claude account, Settings, the area's own links, feedback, sign out). Used by every sidebar footer so the menu and `getInitials` live in one place. With `account`, which only the owner rung may pass, its second line is the Claude account the usage readings reflect, from the System report; below the owner rung, the sign-in user's email.
export function SidebarUserMenu({
  account = false,
  area,
  links = [],
  machine,
  user,
}: {
  account?: boolean
  area?: "dashboard" | "console"
  links?: UserMenuLink[]
  machine: string
  user: User
}) {
  const claude = useAccount(account)
  const identity = userIdentity(
    machine,
    accountLine(user.email, { account: claude.account, owner: account, pending: claude.pending }),
  )

  return (
    <SidebarMenuItem>
      <SidebarDropdownMenu trigger={identity} header={identity} align="end" mobileSide="top">
        <UserMenuItems area={area} links={links} />
      </SidebarDropdownMenu>
    </SidebarMenuItem>
  )
}

// The menu's items, one list for the Console's card and the aside toolbar's square: Update now while an update is available, Settings, the area's cross-link and own links, Documentation, Feedback, and Log out but in the Dashboard, where the first-run pane signs this Mac's owner straight back in.
export function UserMenuItems({
  area,
  links = [],
  logOut = true,
  update = null,
}: {
  area?: "dashboard" | "console"
  links?: UserMenuLink[]
  logOut?: boolean
  update?: MenuUpdate | null
}) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  // The user menu is shared, so the cross-link points at the other workspace: dashboard -> console, console -> dashboard.
  const crossLink =
    area === "dashboard"
      ? { label: "Console", href: "/console", icon: <RiTerminalBoxLine /> }
      : area === "console"
        ? { label: "Dashboard", href: "/dashboard", icon: <RiDashboardLine /> }
        : null

  return (
    <>
      {update && (
        <DropdownMenuItem onClick={update.onUpdate}>
          <RiDownloadCloud2Line className="text-success" />
          Update now
        </DropdownMenuItem>
      )}
      {/* Settings took Home's place; the Console's points at the same page */}
      <DropdownMenuItem render={<Link href="/dashboard/settings" />}>
        <RiSettings3Line />
        Settings
        <RiArrowRightSLine className="text-muted-foreground ml-auto size-4" />
      </DropdownMenuItem>
      {crossLink && (
        <DropdownMenuItem render={<Link href={crossLink.href} />}>
          {crossLink.icon}
          {crossLink.label}
          <RiArrowRightSLine className="text-muted-foreground ml-auto size-4" />
        </DropdownMenuItem>
      )}
      {links.map((link) => (
        <DropdownMenuItem key={link.href} render={<Link href={link.href} onClick={link.onClick} />}>
          {link.icon}
          {link.label}
          <RiArrowRightSLine className="text-muted-foreground ml-auto size-4" />
        </DropdownMenuItem>
      ))}
      {/* Home's link moved here with Settings; the sidebar carries none */}
      <DropdownMenuItem render={<Link href="/docs" />}>
        <RiBookOpenLine />
        Documentation
        <RiArrowRightSLine className="text-muted-foreground ml-auto size-4" />
      </DropdownMenuItem>
      {(env.NEXT_PUBLIC_USERJOT_URL || logOut) && <DropdownMenuSeparator />}
      {env.NEXT_PUBLIC_USERJOT_URL && (
        <DropdownMenuItem
          render={
            <Link href={env.NEXT_PUBLIC_USERJOT_URL} target="_blank" rel="noopener noreferrer" />
          }
        >
          <RiMessage2Line />
          Feedback
        </DropdownMenuItem>
      )}
      {logOut && (
        <DropdownMenuItem
          disabled={signingOut}
          onClick={async () => {
            if (signingOut) return
            setSigningOut(true)
            try {
              await authClient.signOut()
              router.push("/")
            } catch {
              toast.add({ title: "Failed to sign out. Please try again.", type: "error" })
              setSigningOut(false)
            }
          }}
        >
          <RiLogoutBoxLine />
          Log out
        </DropdownMenuItem>
      )}
    </>
  )
}
