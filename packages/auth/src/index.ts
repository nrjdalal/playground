import {
  account,
  db,
  invitation,
  member,
  organization,
  session,
  team,
  teamMember,
  user,
  verification,
} from "@packages/db"
import { env } from "@packages/env/auth"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { oneTimeToken } from "better-auth/plugins"
import { sql } from "drizzle-orm"

import { grantConsoleAccessOnSignIn } from "@/allowlist"
import { cookieConfig, localhostHost, type ParsedHost } from "@/lib/utils"
import { adapterConfig, schemaOptions } from "@/schema"

// The app host's tldts breakdown, inlined at build by @packages/scripts/src/generate-env.ts (see tsdown.config.ts define), so no Public Suffix List ships at runtime. A runtime .localhost host (portless dev, injected after the build) overrides it so web and api share the cookie.
declare const __DERIVED_TLDTS__: ParsedHost
const { cookieDomain, cookiePrefix, isPrivate } = cookieConfig(
  localhostHost(env.HONO_APP_URL) ?? __DERIVED_TLDTS__,
)

// On a public hosting suffix (isPrivate) web and api are sibling sites that cannot share a cookie, so the browser only ever talks to the web, which proxies /api to us and Better Auth builds cookies for the web origin. Everything stays first-party to the web: no cross-site cookie, no handoff.
const apiOrigin = new URL(env.HONO_APP_URL).origin
const nonApiOrigins = [
  ...new Set(
    env.HONO_TRUSTED_ORIGINS.map((o) => {
      try {
        return new URL(o).origin
      } catch {
        return ""
      }
    }).filter((o) => o && o !== apiOrigin),
  ),
]
const webOrigin = isPrivate
  ? env.HONO_WEB_URL
    ? new URL(env.HONO_WEB_URL).origin
    : nonApiOrigins[0]
  : undefined

// HONO_WEB_URL names the web origin explicitly. Without it, a public-suffix host infers the first non-api HONO_TRUSTED_ORIGINS entry: with none distinct from the api, baseURL falls back to the api and cross-origin OAuth cannot complete; with several, it pins to whichever is listed first. Warn either way and point at HONO_WEB_URL.
if (isPrivate && !env.HONO_WEB_URL && nonApiOrigins.length === 0) {
  console.warn(
    `[auth] HONO_APP_URL is a public-suffix host but no HONO_TRUSTED_ORIGINS entry differs from it, so baseURL falls back to the api and sign-in cannot complete (cross-origin OAuth will fail). Set HONO_WEB_URL to your web origin, or use a custom domain.`,
  )
} else if (isPrivate && !env.HONO_WEB_URL && nonApiOrigins.length > 1) {
  console.warn(
    `[auth] inferred the web origin as the first non-api HONO_TRUSTED_ORIGINS entry (${webOrigin}), but ${nonApiOrigins.length} distinct non-api origins are trusted. Set HONO_WEB_URL to pin it explicitly.`,
  )
}

// GitHub sign-in is the hosted build's (Yard's) alone: a member signs in there with GitHub, while a local stack signs its owner in by itself and offers no provider.
if (env.PLAYGROUND_HOSTED && !(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)) {
  throw new Error(
    "PLAYGROUND_HOSTED needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET for its sign-in",
  )
}
const socialProviders =
  env.PLAYGROUND_HOSTED && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          // Every sign-in stamps the GitHub login afresh, so a renamed login follows its account.
          mapProfileToUser: (profile: { login: string }) => ({ login: profile.login }),
          overrideUserInfoOnSignIn: true,
        },
      }
    : undefined

// A GitHub login moves to whoever holds it now: before a sign-in stamps one, any other account still carrying it (a renamed handle, since taken) lets it go, so user.login stays unique.
export const releaseLogin = async (data: Record<string, unknown>) => {
  if (typeof data.login === "string")
    await db
      .update(user)
      .set({ login: null })
      .where(sql`lower(${user.login}) = ${data.login.toLowerCase()}`)
}

export const auth = betterAuth({
  baseURL: webOrigin ?? env.HONO_APP_URL,
  trustedOrigins: env.HONO_TRUSTED_ORIGINS,
  database: drizzleAdapter(db, {
    ...adapterConfig,
    schema: {
      account,
      invitation,
      member,
      organization,
      session,
      team,
      teamMember,
      user,
      verification,
    },
  }),
  ...(socialProviders && { socialProviders }),
  onAPIError: {
    throw: true,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 300,
    },
  },
  databaseHooks: {
    session: { create: { before: grantConsoleAccessOnSignIn } },
    user: { create: { before: releaseLogin }, update: { before: releaseLogin } },
  },
  ...schemaOptions,
  // oneTimeToken mints a single-use, 3-minute token for a signed-in session, which the hosted web hands Yard's socket in its URL, since the API's host never sees the web's cookie: kept hashed, and its verify sets no cookie. It adds no table (it keeps tokens in verification), so it sits beside the schema's plugins rather than among them.
  plugins: [
    ...schemaOptions.plugins,
    oneTimeToken({ disableSetSessionCookie: true, storeToken: "hashed" }),
  ],
  // Only Yard's socket verifies a one-time token, in process (auth.api, which disabledPaths leaves open), since the plugin's own verify route answers the token's session to whoever holds it; a local stack, with no socket, mints none either. Registered on every build, so the plugin's types reach auth.api.
  disabledPaths: env.PLAYGROUND_HOSTED
    ? ["/one-time-token/verify"]
    : ["/one-time-token/generate", "/one-time-token/verify"],
  advanced: {
    // The environment name-prefix isolates cookie names across envs; it applies independent of the cookie-mode switch below (a private-suffix env would still want it).
    ...(cookiePrefix && { cookiePrefix }),
    // Cross-subdomain (custom domains, portless localhost) shares one Domain cookie. A public hosting suffix (isPrivate) and a bare host both stay host-only with SameSite=Lax: on a public suffix the client routes same-origin through the web proxy so the cookie is first-party to the web, and a bare host has no shareable parent to widen to.
    ...(!isPrivate && cookieDomain
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: cookieDomain,
          },
        }
      : {}),
  },
})

export type Session = typeof auth.$Infer.Session
