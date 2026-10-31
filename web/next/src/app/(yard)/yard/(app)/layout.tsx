import { redirect } from "next/navigation"

import { ApiRetry } from "@/components/common/api-retry"
import { SidebarShell } from "@/components/shell/sidebar-shell"
import { YardFooter } from "@/components/yard/yard-footer"
import { YardGroups } from "@/components/yard/yard-groups"
import { YardLive } from "@/components/yard/yard-live"
import { auth } from "@/lib/auth"
import { sessionOrUnavailable, UNAVAILABLE } from "@/lib/auth/session"
import { yardGate } from "@/lib/yard"

// The hosted app's session gate: a signed-out visit goes home to Sign in with GitHub, a user without an invite to the invite page, and a member gets the sidebar's Channels and Direct messages beside the page, with no Inbox aside.
export default async function YardAppLayout({ children }: { children: React.ReactNode }) {
  const session = await sessionOrUnavailable(() =>
    auth.api.getSession({ disableCookieCache: true }),
  )
  if (session === UNAVAILABLE) return <ApiRetry />
  const gate = yardGate(session?.user)
  if (gate === "sign-in") redirect("/")
  if (gate === "invite") redirect("/yard/invite")
  return (
    <SidebarShell
      homeHref="/yard"
      nav={<YardGroups />}
      footer={<YardFooter login={session?.user.login ?? session?.user.name ?? ""} />}
    >
      <YardLive />
      {children}
    </SidebarShell>
  )
}
