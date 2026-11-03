import { redirect } from "next/navigation"

import { ApiRetry } from "@/components/common/api-retry"
import { InviteGate } from "@/components/yard/invite-gate"
import { auth } from "@/lib/auth"
import { sessionOrUnavailable, UNAVAILABLE } from "@/lib/auth/session"
import { yardGate } from "@/lib/yard"

// Yard is invite-only: a signed-in user without an invite redeems a code here, or asks a member for one; a member goes on to the app.
export default async function Page() {
  const session = await sessionOrUnavailable(() =>
    auth.api.getSession({ disableCookieCache: true }),
  )
  if (session === UNAVAILABLE) return <ApiRetry />
  const gate = yardGate(session?.user)
  if (gate === "sign-in") redirect("/")
  if (gate === "app") redirect("/yard")
  return <InviteGate />
}
