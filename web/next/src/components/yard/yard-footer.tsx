"use client"

import { RiKey2Line, RiLogoutBoxLine } from "@remixicon/react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { SidebarDropdownMenu } from "@/components/shell/sidebar-dropdown-menu"
import { userIdentity } from "@/components/shell/sidebar-user-menu"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import { toast } from "@/components/ui/toast"
import { authClient } from "@/lib/auth/client"

// The hosted sidebar's footer: who is signed in, Account and tokens, and Log out.
export function YardFooter({ login }: { login: string }) {
  const router = useRouter()
  const identity = userIdentity(login, "Yard")
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarDropdownMenu trigger={identity} header={identity} align="end" mobileSide="top">
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
