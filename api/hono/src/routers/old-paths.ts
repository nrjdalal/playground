import type { Hono } from "hono"

// The paths the dashboard's routes answered before they moved under /api/v1: each router is mounted a second time at its old path, guards and all, until every caller has moved, and the OpenAPI document leaves the old paths out.
export const OLD_PATHS = {
  apps: "/apps",
  dashboard: "/desk",
  inbox: "/inbox",
  sessions: "/sessions",
} as const

export const OLD_PATHS_DOC = /^\/api\/(apps|desk|inbox|sessions)(\/|$)/

// Any Hono app, since each router carries its own env and schema.
type Router = Hono<any, any, any>

export const mountOldPaths = (
  api: Router,
  routers: Record<keyof typeof OLD_PATHS, Router>,
): void => {
  for (const name of Object.keys(OLD_PATHS) as (keyof typeof OLD_PATHS)[])
    api.route(OLD_PATHS[name], routers[name])
}
