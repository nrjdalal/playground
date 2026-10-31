import { auth } from "@/lib/auth"
import { sessionOrUnavailable, UNAVAILABLE } from "@/lib/auth/session"

// The signed-in member's rung for a Yard page, read past the cookie cache as the layout reads it, so a just-changed role shows at once; with the API down the (app) layout draws its retry state, so a page reads no rung rather than throwing.
export const yardRole = async () => {
  const session = await sessionOrUnavailable(() =>
    auth.api.getSession({ disableCookieCache: true }),
  )
  return session === UNAVAILABLE ? null : (session?.user.role ?? null)
}
