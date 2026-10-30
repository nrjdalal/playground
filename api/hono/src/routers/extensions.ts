import { sValidator } from "@hono/standard-validator"
import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"

import {
  conflictErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { dataDir } from "@/lib/sessions/paths"
import {
  addExtension,
  checkExtension,
  checkSettings,
  EXTENSION_NAME,
  extensionsOf,
  linkOf,
  orderOf,
  removeOf,
  REPO,
  setUpSettings,
  SKILL_NAME,
  syncExtension,
  unlinkOf,
  whySkill,
} from "@/lib/store/extensions"
import { authMiddleware, guardWrites, requireConsoleRole, type StoreVariables } from "@/middlewares"
import { done, invalid, responses } from "@/routers/store"

// An extension already here: a name ext add gave, or the login as GitHub spells it.
const name = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/)
const org = z.string().regex(/^(?:\*|[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})$/)

const who = (c: { get: (key: "user") => unknown }, reason: string) => ({
  actor: (c.get("user") as { id: string }).id,
  author: "owner",
  inboxRef: null,
  reason,
})

// Settings > Extensions, on the owner rung; a write must come from the dashboard's own origin on this machine before anything else is read.
export const extensionsRouter = new Hono<{ Variables: StoreVariables }>()
  .use("/*", guardWrites)
  .use("/*", authMiddleware)
  .use("/*", requireConsoleRole("owner"))
  .get(
    "/",
    describeRoute({
      tags: ["Settings"],
      description:
        "Every extension in priority order with core last: its links, repo, items by kind and last sync, or null before ext init names a login",
      ...responses(),
    }),
    (c) => c.json({ data: { extensions: extensionsOf() } }),
  )
  .get(
    "/why",
    describeRoute({
      tags: ["Settings"],
      description:
        "Which extension a session in a repo of the org (every repo's set with none) takes a skill from, and each one whose copy it hides",
      ...responses(validationErrorResponses, notFoundErrorResponses, conflictErrorResponses),
    }),
    sValidator(
      "query",
      z.strictObject({ org: org.optional(), skill: z.string().regex(SKILL_NAME) }),
      invalid,
    ),
    async (c) => {
      const query = c.req.valid("query")
      const found = done(await whySkill(query.skill, query.org))
      return c.json({ data: { from: found.from, shadowed: found.shadowed } })
    },
  )
  .get(
    "/check",
    describeRoute({
      tags: ["Settings"],
      description:
        "What Add would find on GitHub, making nothing: the repository it would use, whether it is there yet (a public one refused) and how many entries its skills/ holds",
      ...responses(validationErrorResponses, conflictErrorResponses),
    }),
    sValidator(
      "query",
      z.strictObject({
        name: z.string().regex(EXTENSION_NAME),
        repo: z.string().regex(REPO).optional(),
      }),
      invalid,
    ),
    async (c) => {
      const found = done(await checkExtension(c.req.valid("query")))
      return c.json({ data: { exists: found.exists, repo: found.repo, skills: found.skills } })
    },
  )
  .get(
    "/init/check",
    describeRoute({
      tags: ["Settings"],
      description:
        "What Set up settings would use on GitHub, making nothing: the private repository ext init makes or adopts, and whether it is there yet",
      ...responses(conflictErrorResponses),
    }),
    async (c) => {
      const found = done(await checkSettings())
      return c.json({ data: { exists: found.exists, repo: found.repo } })
    },
  )
  .post(
    "/init",
    describeRoute({
      tags: ["Settings"],
      description:
        "Set up settings: run ext init --yes, which makes or adopts the login's private repository and names the login every account and extension write needs",
      ...responses(conflictErrorResponses),
    }),
    async (c) => {
      const set = done(await setUpSettings())
      return c.json({ data: { repo: set.repo } })
    },
  )
  .post(
    "/",
    describeRoute({
      tags: ["Settings"],
      description:
        "Add an extension from its private repo, <login>/playground-<name> unless named; with no yes, a repo that is not there yet comes back as the one it would create, and nothing is made",
      ...responses(validationErrorResponses, conflictErrorResponses),
    }),
    sValidator(
      "json",
      z.strictObject({
        name: z.string().regex(EXTENSION_NAME),
        repo: z.string().regex(REPO).optional(),
        yes: z.boolean().default(false),
      }),
      invalid,
    ),
    async (c) => {
      const added = done(await addExtension(c.req.valid("json")))
      return c.json({
        data: "create" in added ? { create: added.create } : { lines: added.lines },
      })
    },
  )
  .put(
    "/order",
    describeRoute({
      tags: ["Settings"],
      description:
        "Put the extensions named first, in that order, the rest after them as they stood",
      ...responses(validationErrorResponses, notFoundErrorResponses, conflictErrorResponses),
    }),
    sValidator("json", z.strictObject({ names: z.array(name).min(1) }), invalid),
    (c) => {
      const { names } = c.req.valid("json")
      done(orderOf(dataDir(), names, who(c, "reorder the extensions from Settings")))
      return c.json({ data: { extensions: extensionsOf() } })
    },
  )
  .post(
    "/:name/links",
    describeRoute({
      tags: ["Settings"],
      description: "Link an extension to a GitHub org, or to * for every repo",
      ...responses(validationErrorResponses, notFoundErrorResponses, conflictErrorResponses),
    }),
    sValidator("param", z.strictObject({ name }), invalid),
    sValidator("json", z.strictObject({ org }), invalid),
    (c) => {
      const extension = c.req.valid("param").name
      const link = c.req.valid("json").org
      done(linkOf(dataDir(), extension, link, who(c, `link ${extension} to ${link} from Settings`)))
      return c.json({ data: { extensions: extensionsOf() } })
    },
  )
  .delete(
    "/:name/links/:org",
    describeRoute({
      tags: ["Settings"],
      description: "Take one of an extension's links away",
      ...responses(validationErrorResponses, notFoundErrorResponses, conflictErrorResponses),
    }),
    sValidator("param", z.strictObject({ name, org }), invalid),
    (c) => {
      const param = c.req.valid("param")
      done(
        unlinkOf(
          dataDir(),
          param.name,
          param.org,
          who(c, `unlink ${param.name} from ${param.org} from Settings`),
        ),
      )
      return c.json({ data: { extensions: extensionsOf() } })
    },
  )
  .post(
    "/:name/sync",
    describeRoute({
      tags: ["Settings"],
      description: "Sync one extension with its private repo now",
      ...responses(validationErrorResponses, conflictErrorResponses),
    }),
    sValidator("param", z.strictObject({ name }), invalid),
    async (c) => {
      const synced = done(await syncExtension(c.req.valid("param").name))
      return c.json({ data: { lines: synced.lines } })
    },
  )
  .delete(
    "/:name",
    describeRoute({
      tags: ["Settings"],
      description:
        "Take an extension out of the order, links and repos, so no session reads it; its folder stays",
      ...responses(validationErrorResponses, notFoundErrorResponses, conflictErrorResponses),
    }),
    sValidator("param", z.strictObject({ name }), invalid),
    (c) => {
      const extension = c.req.valid("param").name
      done(removeOf(dataDir(), extension, who(c, `remove ${extension} from Settings`)))
      return c.json({ data: { extensions: extensionsOf() } })
    },
  )
