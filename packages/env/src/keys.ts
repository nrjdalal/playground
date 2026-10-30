import "./aliases"
import { z } from "zod"

import { NODE_ENV } from "@/lib/constants"
import { polyfillClient, polyfillServer, serverSecret } from "@/lib/polyfill"
import { dockerHostUrl } from "@/lib/postgres-url"

// Each env schema as its app validates it, the one source the env modules build their createEnv calls from: the shapes, and the values validation reads (runtimeEnv, before emptyStringAsUndefined reads an empty one as unset). Held apart from createEnv so a check can ask what each schema requires without validating anything; every module it reads is browser-safe, since the web's client graph comes through web-next.
export const apiHono = {
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    AGENT_SIGNIN_ENABLED: process.env.AGENT_SIGNIN_ENABLED,
    CHANGELOG_ENABLED: process.env.CHANGELOG_ENABLED,
    CHANGELOG_PEOPLE: process.env.CHANGELOG_PEOPLE,
    HONO_APP_URL: polyfillServer(process.env.HONO_APP_URL, "https://polyfill.url"),
    HONO_HOSTNAME: process.env.HONO_HOSTNAME,
    HONO_PORT: process.env.HONO_PORT,
    HONO_RATE_LIMIT: process.env.HONO_RATE_LIMIT,
    HONO_RATE_LIMIT_WINDOW_MS: process.env.HONO_RATE_LIMIT_WINDOW_MS,
    HONO_TRUSTED_ORIGINS: polyfillServer(process.env.HONO_TRUSTED_ORIGINS, "https://polyfill.url"),
    PLAYGROUND_APPROVALS_ENABLED: process.env.PLAYGROUND_APPROVALS_ENABLED,
    PLAYGROUND_CMUX_SESSIONS: process.env.PLAYGROUND_CMUX_SESSIONS,
    PLAYGROUND_DISPATCHER: process.env.PLAYGROUND_DISPATCHER,
    PLAYGROUND_DISPATCHER_SECONDARY: process.env.PLAYGROUND_DISPATCHER_SECONDARY,
    PLAYGROUND_SDK_PERMISSION_MODE: process.env.PLAYGROUND_SDK_PERMISSION_MODE,
    PLAYGROUND_SDK_PROBE_DIR: process.env.PLAYGROUND_SDK_PROBE_DIR,
  },
  server: {
    NODE_ENV,
    AGENT_SIGNIN_ENABLED: z.stringbool().default(false),
    CHANGELOG_ENABLED: z.stringbool().optional(),
    CHANGELOG_PEOPLE: z
      .string()
      .default("")
      .transform((s) =>
        s
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    HONO_APP_URL: z.url(),
    HONO_HOSTNAME: z.string().default("127.0.0.1"),
    HONO_PORT: z.coerce.number().default(4000),
    HONO_RATE_LIMIT: z.coerce.number().default(60),
    HONO_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
    HONO_TRUSTED_ORIGINS: z
      .string()
      .transform((s) => s.split(",").map((v) => v.trim().replace(/\/$/, "")))
      .pipe(z.array(z.url())),
    PLAYGROUND_APPROVALS_ENABLED: z.stringbool().default(false),
    PLAYGROUND_CMUX_SESSIONS: z.stringbool().default(false),
    PLAYGROUND_DISPATCHER: z.string().optional(),
    PLAYGROUND_DISPATCHER_SECONDARY: z.string().optional(),
    PLAYGROUND_SDK_PERMISSION_MODE: z
      .enum(["acceptEdits", "bypassPermissions", "default", "plan"])
      .default("bypassPermissions"),
    PLAYGROUND_SDK_PROBE_DIR: z.string().optional(),
  },
}

export const auth = {
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    HONO_APP_URL: polyfillServer(process.env.HONO_APP_URL, "https://polyfill.url"),
    HONO_TRUSTED_ORIGINS: polyfillServer(process.env.HONO_TRUSTED_ORIGINS, "https://polyfill.url"),
    HONO_WEB_URL: process.env.HONO_WEB_URL,
  },
  server: {
    NODE_ENV,
    BETTER_AUTH_SECRET: serverSecret(z.string().min(1)),
    HONO_APP_URL: z.url(),
    HONO_TRUSTED_ORIGINS: z
      .string()
      .transform((s) => s.split(",").map((v) => v.trim().replace(/\/$/, "")))
      .pipe(z.array(z.url())),
    HONO_WEB_URL: z.url().optional(),
  },
}

export const db = {
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    // Read when the db schema is built rather than when this module loads, since first run's setup sets the URL in the running API after its own env loaded this module.
    get POSTGRES_URL() {
      return polyfillServer(
        process.env.INTERNAL_API_URL
          ? dockerHostUrl(process.env.POSTGRES_URL)
          : process.env.POSTGRES_URL,
        "postgres://polyfill.local:5432/db",
      )
    },
  },
  server: {
    NODE_ENV,
    POSTGRES_URL: z.url(),
  },
}

export const redis = {
  runtimeEnv: {
    REDIS_URL: process.env.REDIS_URL,
  },
  server: {
    REDIS_URL: z.url().optional(),
  },
}

export const webNext = {
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
    NEXT_PUBLIC_API_URL: z.url(),
    NEXT_PUBLIC_NODE_ENV: NODE_ENV,
    NEXT_PUBLIC_POSTHOG_HOST: z.url().optional(),
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().optional(),
    NEXT_PUBLIC_USERJOT_URL: z.url().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    INTERNAL_API_URL: process.env.INTERNAL_API_URL,
    NEXT_PUBLIC_API_URL: polyfillClient(process.env.NEXT_PUBLIC_API_URL, "https://polyfill.url"),
    NEXT_PUBLIC_APP_URL: polyfillClient(process.env.NEXT_PUBLIC_APP_URL, "https://polyfill.url"),
    NEXT_PUBLIC_NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    NEXT_PUBLIC_USERJOT_URL: process.env.NEXT_PUBLIC_USERJOT_URL,
  },
  server: {
    NODE_ENV,
    INTERNAL_API_URL: z.url().optional(),
  },
}
