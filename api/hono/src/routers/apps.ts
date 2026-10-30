import { sValidator } from "@hono/standard-validator"
import type { Session } from "@packages/auth"
import { env } from "@packages/env/api-hono"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import { readOpsReport } from "@/lib/apps/ops-report"
import { readPlan } from "@/lib/apps/plan"
import { orderLanesSchema, readOrder, writeOrder } from "@/lib/apps/plan-order"
import { previewHeaders, previewsDir, readPreview, readPreviews } from "@/lib/apps/previews"
import { DISPATCHER } from "@/lib/dashboard/workers"
import {
  ApiError,
  authErrorResponses,
  errorResponse,
  forbiddenErrorResponses,
  notFoundErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import { usageReport } from "@/lib/usage/report"
import { authMiddleware, createRateLimiter, guardWrites, requireConsoleRole } from "@/middlewares"
import { pluginsRouter } from "@/plugins/registry"

// A drag writes the whole order; a run of quick drags stays well under this, which only stops a stuck client.
export const orderLimiter = createRateLimiter({
  getUserId: (c) => c.get("session")?.userId,
  limit: 30,
  windowMs: 60_000,
})

export const orderBodySchema = z.strictObject({ lanes: orderLanesSchema })

// The preview route's work: the file's bytes with previewHeaders, framable by the dashboard's own pages alone, or a 404 when the name names no preview the dashboard serves.
export async function servePreview(
  name: string,
  read: (name: string) => ReturnType<typeof readPreview> = readPreview,
  origins: readonly string[] = env.HONO_TRUSTED_ORIGINS,
): Promise<Response> {
  const found = await read(name)
  if (!found) {
    throw new ApiError(
      404,
      "NOT_FOUND",
      "No preview by that name: a PNG, GIF, WebP or HTML file directly in the previews folder",
    )
  }
  return new Response(found.bytes, { headers: previewHeaders(found.file, origins) })
}

// A Pages tab's session: its name, as the roster and pages.jsonl give it.
const previewsQuerySchema = z.object({ session: z.string().min(1).max(200).optional() })

// Apps are tools on the dashboard beside the workers, on the dashboard's own owner rung, since they read the same transcripts. Each shows what a skill produced. One writes: the Plan board's order, which steers what the planner builds first; so before anything else it must come from the dashboard's own page on this machine.
export const appsRouter = new Hono<{ Variables: Session }>()
  .use("/*", guardWrites)
  .use("/*", authMiddleware)
  .use("/*", requireConsoleRole("owner"))
  .get(
    "/plan",
    describeRoute({
      tags: ["Apps"],
      description:
        "The plan the planner keeps in bundles/plan.json in the data folder: when it was groomed, what lands next, each lane's items with the plain-words line for the owner (an item without one is refused), what is in flight and what merged today (plan, null when the file is missing or has never read), each part that did not read, named (problems), whether plan is the last good read because the file does not read now (stale), and the owner's own order of each lane's queued items from the board, bundles/order.json in the data folder (order, null until they drag one).",
      responses: {
        200: { description: "OK" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
    }),
    async (c) => {
      const [read, order] = await Promise.all([readPlan(), readOrder()])
      const problems = order.problem ? [...read.problems, order.problem] : read.problems
      return c.json({ data: { ...read, order: order.order, problems } })
    },
  )
  .post(
    "/plan/order",
    describeRoute({
      tags: ["Apps"],
      description:
        "Set the owner's build order from the Plan page's board: each lane's queued item ids, first to build first, written whole to bundles/order.json in the data folder (never plan.json), which the planner keeps pinned on every re-groom. Returns the order as written.",
      responses: {
        200: {
          description: "Written",
          content: {
            "application/json": {
              schema: resolver(z.object({ data: z.object({ updatedAt: z.string() }).loose() })),
            },
          },
        },
        ...validationErrorResponses,
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        500: errorResponse("INTERNAL_SERVER_ERROR", "order.json could not be written"),
      },
    }),
    orderLimiter,
    sValidator("json", orderBodySchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", { issues: result.error })
      }
    }),
    async (c) => {
      try {
        return c.json({ data: await writeOrder(c.req.valid("json").lanes) })
      } catch {
        throw new ApiError(500, "INTERNAL_SERVER_ERROR", "The order could not be saved")
      }
    },
  )
  .get(
    "/plan/report",
    describeRoute({
      tags: ["Apps"],
      description:
        "The ops report the ops-report job writes in plain words, ops/report.json in the data folder: what needs attention and why, who owns it and since when (findings), the factory's health and the machine's (health), what changed since the last report (changes) and what merged today (merges), null when the file is missing or has never read (report); the reports kept before it in ops/reports/ beside it, newest first, at most 10 (earlier); each part that did not read, named (problems); and whether report is the last good read because the file does not read now (stale). Read-only.",
      responses: {
        200: { description: "OK" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
    }),
    async (c) => c.json({ data: await readOpsReport() }),
  )
  .get(
    "/previews",
    describeRoute({
      tags: ["Apps"],
      description:
        "Every preview in previews in the data folder, newest first: each PNG, GIF, WebP or HTML file's name, kind (image or html), topic (its name before the first - or .), caption (from a .txt of the same name), last change, size and, for a page `playground page` kept, its pages.jsonl record (page: at, by, for, title) (previews), and each file that looks like a preview but is not served, or pages.jsonl line that is not a page's record, named with why (problems). With ?session=<name>, only the pages that session made or that were made for it, every page for the primary dispatcher, newest kept first. Read-only.",
      responses: {
        200: { description: "OK" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...validationErrorResponses,
      },
    }),
    sValidator("query", previewsQuerySchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", { issues: result.error })
      }
    }),
    async (c) => {
      const { session } = c.req.valid("query")
      const filter = session === undefined ? undefined : { dispatcher: DISPATCHER, session }
      return c.json({ data: await readPreviews(previewsDir(), filter) })
    },
  )
  .get(
    "/previews/:name",
    describeRoute({
      tags: ["Apps"],
      description:
        "One preview's bytes, by its name: an image as itself, an HTML page as a sandboxed document (its own inline script alone, no form, no same-origin, nothing fetched but data:) that only the Dashboard's own pages may frame",
      responses: {
        200: { description: "The file" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
        ...notFoundErrorResponses,
      },
    }),
    (c) => servePreview(c.req.param("name")),
  )
  .get(
    "/usage",
    describeRoute({
      tags: ["Apps"],
      description:
        "Token use and API-equivalent dollars from the claude_* tables, today and over the last 7 days: by agent (each session rolled up to the session at the top of its parents), the 20 costliest sessions of the week and of today, by model and by hour over the last 24, with Claude Code's own totals beside this table's (calibration); each PR merged this week in a repo a worker opened one in, with its worker's spend, its share of that sin's reviewer and tester, its review rounds, wall time and any fix PR within 7 days (prs, with prsPending true while a repo's first read from GitHub is still going); the usage windows with a forecast at the current burn (windows, null when the usage job has written none); and what could not be read or priced (problems)",
      responses: {
        200: { description: "OK" },
        ...authErrorResponses,
        ...forbiddenErrorResponses,
      },
    }),
    async (c) => c.json({ data: await usageReport() }),
  )
  .route("/", pluginsRouter)
