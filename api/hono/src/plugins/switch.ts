import { features } from "@packages/config/site"
import { env } from "@packages/env/api-hono"
import type { MiddlewareHandler } from "hono"

// Each plugin's switch: its env override when one is set, else its default in ZeroStarter's features map. Off means inert: its routes 404 and its CLI writes nothing.
export const SWITCHES = {
  changelog: () => env.CHANGELOG_ENABLED ?? features.changelog,
}

export type PluginId = keyof typeof SWITCHES

export const pluginOn = (id: PluginId): boolean => SWITCHES[id]()

// 404 a plugin's routes while its switch is off, as requireFeature does for a feature; the routes stay mounted, so AppType is the same either way.
export const requirePlugin =
  (id: PluginId, on: (id: PluginId) => boolean = pluginOn): MiddlewareHandler =>
  async (c, next) => {
    if (!on(id)) return c.notFound()
    await next()
  }
