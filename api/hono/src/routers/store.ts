import { sValidator } from "@hono/standard-validator"
import { db } from "@packages/db"
import {
  contentFields,
  diffItem,
  itemHistory,
  itemKeySchema,
  judgeItem,
  KINDS,
  listItems,
  putItem,
  SCOPE_NAME,
  searchItems,
  showItem,
} from "@packages/settings"
import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"

import {
  ApiError,
  authErrorResponses,
  conflictErrorResponses,
  forbiddenErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { dataDir } from "@/lib/sessions/paths"
import { appWords } from "@/lib/store/app-words"
import { knownInboxRefs, type Result, type Who } from "@/lib/store/settings"
import { authMiddleware, guardWrites, requireConsoleRole, type StoreVariables } from "@/middlewares"

const CODE = { 400: "VALIDATION_ERROR", 404: "NOT_FOUND", 409: "CONFLICT" } as const

export const invalid = (result: { success: boolean; error?: unknown }) => {
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", { issues: result.error })
  }
}

export const done = <T>(result: Result<T>) => {
  if (!result.ok) throw new ApiError(result.status, CODE[result.status], appWords(result.message))
  return result
}

export const whyFields = {
  by: z.string().min(1),
  inboxRef: z.number().int().positive().nullable().default(null),
  reason: z.string().trim().min(1),
}

// Who a write is from: the dashboard's page, so the owner; an inbox ref must name an item this machine holds.
export const whoOf = async (
  c: { get: (key: "user") => unknown },
  input: { by: string; inboxRef: number | null; reason: string },
): Promise<Who> => {
  if (input.inboxRef !== null && !(await knownInboxRefs(db, [input.inboxRef])).has(input.inboxRef))
    throw new ApiError(400, "VALIDATION_ERROR", `no inbox item #i${input.inboxRef} on this machine`)
  return {
    actor: (c.get("user") as { id: string }).id,
    author: "owner",
    inboxRef: input.inboxRef,
    reason: input.reason,
  }
}

// Kept for the settings router until it drops its render field: the extensions are their folders, so nothing renders.
export const render = async () => ({ files: 0, set: "unchanged" })

export const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `no ${what}`)

export const responses = (...extra: object[]) => ({
  responses: Object.assign(
    { 200: { description: "OK" } },
    authErrorResponses,
    forbiddenErrorResponses,
    ...extra,
  ),
})

// The extensions' routes, on the owner rung like every dashboard router, which the CLI reaches with its token instead of a session; a write from a page must come from the dashboard's own origin on this machine before anything else is read. Each calls the same lib playground ext runs, so the folder's rules are one.

const scopeName = z.string().regex(SCOPE_NAME)
const refSchema = z.strictObject({ key: itemKeySchema, kind: z.enum(KINDS), scope: scopeName })
const revSchema = z.string().regex(/^[0-9a-f]{7,40}$/)

const contentSchema = z.strictObject({
  attachments: z
    .array(z.strictObject({ bytes: z.string(), mime: z.string().min(1), name: z.string().min(1) }))
    .default([]),
  body: contentFields.body.default(null),
  files: contentFields.files.default(null),
  value: contentFields.value.default(null),
})

const refOf = (c: { req: { param: (name: string) => string } }) => {
  const parsed = refSchema.safeParse({
    key: c.req.param("key"),
    kind: c.req.param("kind"),
    scope: c.req.param("scope"),
  })
  if (!parsed.success)
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid item", { issues: parsed.error })
  return parsed.data
}

export const extRouter = new Hono<{ Variables: StoreVariables }>()
  .use("/*", guardWrites)
  .use("/*", authMiddleware)
  .use("/*", requireConsoleRole("owner"))
  .get(
    "/items",
    describeRoute({
      tags: ["Extensions"],
      description: "Every item each scope holds, by scope, kind and key, accepted or proposed",
      ...responses(validationErrorResponses),
    }),
    sValidator(
      "query",
      z.strictObject({ kind: z.enum(KINDS).optional(), scope: scopeName.optional() }),
      invalid,
    ),
    (c) => c.json({ data: listItems(dataDir(), c.req.valid("query")) }),
  )
  .get(
    "/items/:scope/:kind/:key",
    describeRoute({
      tags: ["Extensions"],
      description:
        "An item as it stands, its accepted copy else its proposal, or as the commit named by rev wrote it",
      ...responses(validationErrorResponses, notFoundErrorResponses),
    }),
    sValidator("query", z.strictObject({ rev: revSchema.optional() }), invalid),
    (c) => {
      const item = showItem(dataDir(), refOf(c), c.req.valid("query").rev)
      if (!item) throw notFound("such item or revision")
      return c.json({ data: item })
    },
  )
  .post(
    "/items/:scope/:kind/:key",
    describeRoute({
      tags: ["Extensions"],
      description:
        "Write an item's next revision, a whole copy with a reason, as one commit in its scope: a list lands accepted, any other kind proposed for review, and the owner's own write from the dashboard accepted",
      ...responses(validationErrorResponses, conflictErrorResponses),
    }),
    sValidator("json", contentSchema.extend(whyFields), invalid),
    async (c) => {
      const { by, inboxRef, reason, ...content } = c.req.valid("json")
      const who = await whoOf(c, { by, inboxRef, reason })
      const put = done(putItem(dataDir(), refOf(c), content, who, true))
      return c.json({ data: { rev: put.rev, state: put.state } })
    },
  )
  .post(
    "/items/:scope/:kind/:key/revisions/:rev/judge",
    describeRoute({
      tags: ["Extensions"],
      description:
        "Judge a proposal with a reason: score records a reviewer's 0 to 5 and a 5 accepts it, accept is the owner's own call, reject removes it; each refuses unless the proposal is still the commit named",
      ...responses(validationErrorResponses, notFoundErrorResponses, conflictErrorResponses),
    }),
    sValidator(
      "json",
      z
        .strictObject({
          ...whyFields,
          reviewer: z.string().min(1).optional(),
          score: z.number().int().min(0).max(5).optional(),
          verdict: z.enum(["accept", "reject", "score"]),
        })
        .refine(
          (input) =>
            input.verdict === "score"
              ? input.score !== undefined && input.reviewer !== undefined
              : input.score === undefined && input.reviewer === undefined,
          "a score takes its score and reviewer, and only a score does",
        ),
      invalid,
    ),
    async (c) => {
      const { by, inboxRef, reason, reviewer, score, verdict } = c.req.valid("json")
      const rev = revSchema.safeParse(c.req.param("rev"))
      if (!rev.success) throw new ApiError(400, "VALIDATION_ERROR", "a rev is a commit sha")
      const judged = done(
        judgeItem(
          dataDir(),
          refOf(c),
          rev.data,
          verdict === "score"
            ? { kind: "score", reviewer: reviewer!, score: score! }
            : { kind: verdict },
          await whoOf(c, { by, inboxRef, reason }),
        ),
      )
      return c.json({ data: { rev: judged.rev, state: judged.state } })
    },
  )
  .get(
    "/items/:scope/:kind/:key/why",
    describeRoute({
      tags: ["Extensions"],
      description:
        "Every commit that wrote or judged an item, newest first, with its author, reason and trailers",
      ...responses(validationErrorResponses),
    }),
    (c) => c.json({ data: itemHistory(dataDir(), refOf(c)) }),
  )
  .get(
    "/items/:scope/:kind/:key/diff",
    describeRoute({
      tags: ["Extensions"],
      description: "git's diff of an item's paths between two commits of its scope",
      ...responses(validationErrorResponses, notFoundErrorResponses),
    }),
    sValidator("query", z.strictObject({ from: revSchema, to: revSchema }), invalid),
    (c) => {
      const { from, to } = c.req.valid("query")
      const diff = diffItem(dataDir(), refOf(c), from, to)
      if (!diff) throw notFound("such revision")
      return c.json({ data: diff })
    },
  )
  .get(
    "/search",
    describeRoute({
      tags: ["Extensions"],
      description: "The words in each scope's accepted items, by line, at most 50",
      ...responses(validationErrorResponses),
    }),
    sValidator(
      "query",
      z.strictObject({ kind: z.enum(KINDS).optional(), q: z.string().trim().min(1) }),
      invalid,
    ),
    (c) => {
      const { kind, q } = c.req.valid("query")
      return c.json({ data: searchItems(dataDir(), q, kind) })
    },
  )
