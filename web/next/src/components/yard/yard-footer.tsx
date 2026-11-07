"use client"

import { RiDashboardLine, RiKey2Line, RiLogoutBoxLine } from "@remixicon/react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { SidebarDropdownMenu } from "@/components/shell/sidebar-dropdown-menu"
import { userIdentity } from "@/components/shell/sidebar-user-menu"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { toast } from "@/components/ui/toast"
import { authClient } from "@/lib/auth/client"

// The hosted sidebar's footer: who is signed in, the owner's way back to the dashboard, Account and tokens, and Log out.
export function YardFooter({ login, owner }: { login: string; owner: boolean }) {
  const router = useRouter()
  const identity = userIdentity(login, "Yard")
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarDropdownMenu trigger={identity} header={identity} align="end" mobileSide="top">
          {owner && (
            <DropdownMenuItem render={<Link href="/dashboard" />}>
              <RiDashboardLine />
              Dashboard
            </DropdownMenuItem>
          )}
          <DropdownMenuItem render={<Link href="/yard/account" />}>
            <RiKey2Line />
            Account and tokens
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              try {
                await authClient.signOut()
                router.push("/")
              } catch {
                toast.add({ title: "Failed to sign out. Please try again.", type: "error" })
              }
            }}
          >
            <RiLogoutBoxLine />
            Log out
          </DropdownMenuItem>
        </SidebarDropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
