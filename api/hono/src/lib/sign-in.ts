import { auth } from "@packages/auth"
import { makeSignature } from "better-auth/crypto"
import type { Context } from "hono"
import { setCookie } from "hono/cookie"

// Signs the browser in as one user with no password or provider: a session made on the server and its signed cookie set as better-auth sets it. Only routes that have already proved the request comes from this machine call it (the agent route, onboarding).
export async function signInAs(c: Context, userId: string): Promise<void> {
  const ctx = await auth.$context
  const session = await ctx.internalAdapter.createSession(userId)
  const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`
  const { name, attributes } = ctx.authCookies.sessionToken
  setCookie(c, name, signed, {
    path: attributes.path,
    maxAge: attributes.maxAge,
    httpOnly: attributes.httpOnly ?? true,
    secure: attributes.secure,
    sameSite: attributes.sameSite ?? "Lax",
    domain: attributes.domain,
  })
}
