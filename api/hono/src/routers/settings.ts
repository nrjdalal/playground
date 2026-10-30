import { sValidator } from "@hono/standard-validator"
import {
  extScopeSchema,
  listSettings,
  readSetting,
  resetSetting,
  setSetting,
  settingHistory,
} from "@packages/settings"
import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"

import {
  conflictErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { dataDir } from "@/lib/sessions/paths"
import { authMiddleware, guardWrites, requireConsoleRole, type StoreVariables } from "@/middlewares"
import { done, invalid, notFound, responses, whoOf, whyFields } from "@/routers/store"

const scopeQuery = z.strictObject({ org: z.string().optional() })

export const settingsRouter = new Hono<{ Variables: StoreVariables }>()
  .use("/*", guardWrites)
  .use("/*", authMiddleware)
  .use("/*", requireConsoleRole("owner"))
  .get(
    "/",
    describeRoute({
      tags: ["Settings"],
      description:
        "Every setting a piece defines, with its default and aliases, every row set at a scope, and the settings' schemaVersion",
      ...responses(),
    }),
    async (c) => c.json({ data: listSettings(dataDir()) }),
  )
  .get(
    "/:key",
    describeRoute({
      tags: ["Settings"],
      description:
        "One setting as a session of the org reads it: its value, its default and every row that sets it, an alias read through to its key",
      ...responses(notFoundErrorResponses),
    }),
    sValidator("query", scopeQuery, invalid),
    async (c) => {
      const read = readSetting(dataDir(), c.req.param("key"), c.req.valid("query").org)
      if (!read) throw notFound(`setting ${c.req.param("key")}`)
      return c.json({ data: read })
    },
  )
  .get(
    "/:key/why",
    describeRoute({
      tags: ["Settings"],
      description:
        "Every change to a setting, under its key and each alias, newest first, with who asked, how it came in and why",
      ...responses(notFoundErrorResponses),
    }),
    async (c) => {
      const history = settingHistory(dataDir(), c.req.param("key"))
      if (!history) throw notFound(`setting ${c.req.param("key")}`)
      return c.json({ data: history })
    },
  )
  .put(
    "/:key",
    describeRoute({
      tags: ["Settings"],
      description:
        "Set a setting at a scope with a reason; its key's schema checks the value, and a secret-shaped value is refused",
      ...responses(validationErrorResponses),
    }),
    sValidator(
      "json",
      z.strictObject({ ...whyFields, scope: extScopeSchema, value: z.unknown() }),
      invalid,
    ),
    async (c) => {
      const input = c.req.valid("json")
      const set = done(
        setSetting(dataDir(), { ...input, key: c.req.param("key") }, await whoOf(c, input)),
      )
      return c.json({ data: { key: set.key, scope: set.scope, value: set.value } })
    },
  )
  .post(
    "/:key/reset",
    describeRoute({
      tags: ["Settings"],
      description: "Take a setting back to its default at a scope, with a reason",
      ...responses(validationErrorResponses, notFoundErrorResponses, conflictErrorResponses),
    }),
    sValidator("json", z.strictObject({ ...whyFields, scope: extScopeSchema }), invalid),
    async (c) => {
      const input = c.req.valid("json")
      const reset = done(
        resetSetting(
          dataDir(),
          { key: c.req.param("key"), scope: input.scope },
          await whoOf(c, input),
        ),
      )
      return c.json({ data: { key: reset.key, scope: reset.scope } })
    },
  )
