import { sValidator } from "@hono/standard-validator"
import type { Session } from "@packages/auth"
import { db } from "@packages/db"
import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { z } from "zod"

import {
  ApiError,
  authErrorResponses,
  forbiddenErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { paging } from "@/lib/paging"
import { ENTRY_KINDS, SESSION_KINDS } from "@/lib/sessions/lines"
import {
  listSessions,
  liveSessions,
  readEntries,
  readSession,
  readSteps,
  SESSION_SORTS,
  sessionExists,
} from "@/lib/sessions/read"
import { authMiddleware, guardWrites, requireConsoleRole } from "@/middlewares"

const invalid = (result: { success: boolean; error?: unknown }) => {
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", { issues: result.error })
  }
}

// A comma-separated facet, deduped and held to the values there are.
const facetSchema = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((value) => (value ? [...new Set(value.split(","))] : []))
    .pipe(z.array(z.enum(values)).max(values.length))

const listQuerySchema = z.object({
  dir: z.enum(["asc", "desc"]).default("desc"),
  kind: facetSchema(SESSION_KINDS),
  // A comma-separated list of exact session names, as a session's chain links to them.
  name: z
    .string()
    .max(1000)
    .refine((value) => !value.includes("\u0000"), "name cannot hold a NUL")
    .optional()
    .transform((value) => (value ? [...new Set(value.split(",").filter(Boolean))] : []))
    .pipe(z.array(z.string().max(200)).max(10)),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
  // Postgres refuses a NUL in any text it is handed.
  q: z
    .string()
    .trim()
    .max(254)
    .refine((value) => !value.includes("\u0000"), "q cannot hold a NUL")
    .optional(),
  sort: z.enum(SESSION_SORTS).default("lastActive"),
})

// The first page names the step it comes before; each later page passes the before the last one answered.
export const stepsQuerySchema = z
  .object({
    before: z.coerce.number().int().min(0).optional(),
    beforeId: z.string().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .refine((query) => (query.before === undefined) !== (query.beforeId === undefined), {
    message: "Pass one of before and beforeId",
  })

const entriesQuerySchema = z.object({
  before: z.coerce.number().int().min(0).optional(),
  kind: facetSchema(ENTRY_KINDS),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

// Every Claude Code session the importer has read into the dashboard's database, past and present. Their logs hold whatever a session read or ran, so this sits on the dashboard's owner rung and only reads.
export const sessionsRouter = new Hono<{ Variables: Session }>()
  .use("/*", guardWrites)
  .use("/*", authMiddleware)
  .use("/*", requireConsoleRole("owner"))
  .get(
    "/",
    describeRoute({
      tags: ["Sessions"],
      description:
        "Every session in the database, newest activity first, with whether it runs now (null for a subagent, which the registry cannot see); q matches a name, task, title, the start of an id, or any word of a session's log, and name keeps to the sessions of those exact names",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
    }),
    sValidator("query", listQuerySchema, invalid),
    async (c) => {
      const input = c.req.valid("query")
      const { rows, total } = await listSessions(
        db,
        {
          dir: input.dir,
          kinds: input.kind,
          names: input.name,
          page: input.page,
          perPage: input.perPage,
          q: input.q,
          sort: input.sort,
        },
        await liveSessions(),
      )
      return c.json({
        data: { sessions: rows, ...paging({ page: input.page, perPage: input.perPage, total }) },
      })
    },
  )
  .get(
    "/:id",
    describeRoute({
      tags: ["Sessions"],
      description:
        "One session: what it is, where and on what it ran, its tokens and cost, its PRs, how it began (a /clear, a handover note or a fresh start), the session that started it, the ones it started, and the sessions sharing its name before and after it",
      responses: {
        200: { description: "OK" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
      },
    }),
    async (c) => {
      const session = await readSession(db, c.req.param("id"), await liveSessions())
      if (!session) throw new ApiError(404, "NOT_FOUND", "No session with that id")
      return c.json({ data: session })
    },
  )
  .get(
    "/:id/entries",
    describeRoute({
      tags: ["Sessions"],
      description:
        "One page of a session's log in file order, newest page first, holding only the kinds named (every kind when none are): pass the before it returns to read the page before it",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
      },
    }),
    sValidator("query", entriesQuerySchema, invalid),
    async (c) => {
      const { before, kind, limit } = c.req.valid("query")
      const id = c.req.param("id")
      const page = await readEntries(db, id, { before, kinds: kind, limit })
      if (page.entries.length === 0 && !(await sessionExists(db, id))) {
        throw new ApiError(404, "NOT_FOUND", "No session with that id")
      }
      return c.json({ data: page })
    },
  )
  .get(
    "/:id/steps",
    describeRoute({
      tags: ["Sessions"],
      description:
        "A worker's steps before one its live view already shows, as the live view makes them (what it was asked, what it said, each tool it called), read from the database: the first page names that step (beforeId), each later page passes the before the last one answered, and anchored is false while the database has not read the named step's line yet",
      responses: {
        200: { description: "OK" },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
      },
    }),
    sValidator("query", stepsQuerySchema, invalid),
    async (c) => {
      const id = c.req.param("id")
      if (!(await sessionExists(db, id))) {
        throw new ApiError(404, "NOT_FOUND", "No session with that id")
      }
      return c.json({ data: await readSteps(db, id, c.req.valid("query")) })
    },
  )
