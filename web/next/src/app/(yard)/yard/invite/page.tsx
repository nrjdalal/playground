import { redirect } from "next/navigation"

import { InviteGate } from "@/components/yard/invite-gate"
import { auth } from "@/lib/auth"
import { yardGate } from "@/lib/yard"

// Yard is invite-only: a signed-in user without an invite redeems a code here, or asks a member for one; a member goes on to the app.
export default async function Page() {
  const session = await auth.api.getSession({ disableCookieCache: true })
  const gate = yardGate(session?.user)
  if (gate === "sign-in") redirect("/")
  if (gate === "app") redirect("/yard")
  return <InviteGate />
}
