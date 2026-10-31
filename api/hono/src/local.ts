import { site } from "@packages/config/site"
import { db } from "@packages/db"
import { getBuildVersion } from "@packages/env"
import { env } from "@packages/env/api-hono"
import { describeRoute, openAPIRouteHandler, resolver } from "hono-openapi"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"

import { apiReference, serveScalarBundle } from "@/lib/api-reference"
import { baseApp } from "@/lib/base-app"
import { keepSweeping } from "@/lib/dashboard/attachments"
import { startSdkProbe } from "@/lib/dashboard/sdk"
import { globalErrorResponses } from "@/lib/error"
import { DB_TIMEOUT_MS, healthData } from "@/lib/health"
import { createServer, upgradeWebSocket } from "@/lib/server"
import { yardClient } from "@/lib/yard/client"
import { startYardPoll } from "@/lib/yard/inbound"
import { requireFeature } from "@/middlewares"
import {
  accountsRouter,
  agentsRouter,
  appsRouter,
  authRouter,
  dashboardRouter,
  dispatcherRouter,
  extensionsRouter,
  extRouter,
  inboxRouter,
  localYardRouter,
  onboardRouter,
  sessionsRouter,
  settingsRouter,
  v1Router,
  waitlistRouter,
} from "@/routers"
import { mountOldPaths, OLD_PATHS_DOC } from "@/routers/old-paths"

const BUILD_VERSION = getBuildVersion()

// The local dashboard's whole API, which index.ts serves unless PLAYGROUND_HOSTED picks hosted.ts.
export const app = baseApp()

const routes = app
  .get("/", (c) => {
    const data = { version: BUILD_VERSION, environment: env.NODE_ENV }
    return c.json({ data })
  })
  .get("/headers", (c) => {
    if (env.NODE_ENV !== "local" && env.NODE_ENV !== "development") {
      throw new HTTPException(403, { message: "Forbidden" })
    }
    const data = c.req.header()
    return c.json({ data })
  })
  .basePath("/api")
  .get(
    "/health",
    describeRoute({
      tags: ["System"],
      description: "Get the system health",
      ...({
        "x-codeSamples": [
          {
            lang: "typescript",
            label: "hono/client",
            source: `import { apiClient, unwrap } from "@/lib/api/client"

const { data, error } = await unwrap(apiClient.health.$get())`,
          },
        ],
      } as object),
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  data: z.object({
                    db: z.enum(["ok", "unreachable"]).meta({
                      description: `A \`select 1\` against this stack's database, answered within ${DB_TIMEOUT_MS / 1000}s of its being asked, so a hung database degrades the route instead of holding it`,
                      example: "ok",
                    }),
                    dbError: z
                      .string()
                      .optional()
                      .meta({
                        description: "Why the database is unreachable; present only when db is",
                        example: `no answer from the database within ${DB_TIMEOUT_MS}ms`,
                      }),
                    dashboard: z.enum(["fixture", "hosted", "live", "refused"]).meta({
                      description:
                        "Where this stack reads sessions and their files from: a fixture (a made-up machine, the default on every branch but the live dashboard's), the live machine, or nothing (the hosted build, or refused settings)",
                      example: "fixture",
                    }),
                    dispatcherSlots: z.number().int().min(1).meta({
                      description:
                        "How many dispatcher rows the Dashboard's sidebar header draws: the primary's, plus the second's while a session of its name is registered or the roster lists it. A stored sidebar draws that many rows, placeholders for those it lacks, so the rows arriving move nothing below them",
                      example: 2,
                    }),
                    environment: z
                      .enum(["local", "development", "test", "staging", "production"])
                      .meta({ example: env.NODE_ENV }),
                    message: z.enum(["ok", "degraded"]).meta({
                      description: "The overall status: degraded when db is unreachable",
                      example: "ok",
                    }),
                    version: z.string().meta({ example: BUILD_VERSION }),
                    vibe: z.string().nullable().meta({
                      description:
                        "This checkout's branch while it runs as a Vibeground, started from the Inbox's Preview row on a copy of the live data, else null; its pages wear a Vibeground badge with it",
                      example: null,
                    }),
                  }),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => c.json({ data: await healthData() }),
  )
  .get(
    "/health/ws",
    describeRoute({
      tags: ["System"],
      description:
        "Live system health over a WebSocket. On connect the server sends a snapshot, then a heartbeat every 5s. Each frame is JSON: { message, version, environment, timestamp }.",
      ...({
        "x-codeSamples": [
          {
            lang: "typescript",
            label: "hono/client",
            source: `import { apiClient } from "@/lib/api/client"

const socket = apiClient.health.ws.$ws()
socket.addEventListener("message", (event) => {
  const health = JSON.parse(event.data)
})`,
          },
        ],
      } as object),
      responses: {
        101: { description: "Switching Protocols: the WebSocket handshake succeeded." },
      },
    }),
    upgradeWebSocket(() => {
      let heartbeat: ReturnType<typeof setInterval> | null = null
      const snapshot = () =>
        JSON.stringify({
          message: "ok",
          version: BUILD_VERSION,
          environment: env.NODE_ENV,
          timestamp: new Date().toISOString(),
        })
      return {
        onOpen(_event, ws) {
          ws.send(snapshot())
          heartbeat = setInterval(() => ws.send(snapshot()), 5000)
        },
        // onClose fires on every disconnect on both adapters (Bun has no error event; ws always emits close after error), so this covers all cleanup.
        onClose() {
          if (heartbeat) clearInterval(heartbeat)
        },
      }
    }),
  )
  .route("/agents", agentsRouter)
  .route("/auth", authRouter)
  // the dashboard's routes sit beside user and admin under /api/v1, the dashboard router's with no segment of its own; each mounts before v1Router, so its write guards run before v1Router's session read
  .route("/v1/onboard", onboardRouter)
  .route("/v1/dashboard/dispatcher", dispatcherRouter)
  .route("/v1", dashboardRouter)
  .route("/v1/accounts", accountsRouter)
  .route("/v1/apps", appsRouter)
  .route("/v1/ext", extRouter)
  .route("/v1/extensions", extensionsRouter)
  .route("/v1/inbox", inboxRouter)
  .route("/v1/sessions", sessionsRouter)
  .route("/v1/settings", settingsRouter)
  .route("/v1/yard", localYardRouter)
  .route("/v1", v1Router)
  .route("/waitlist", waitlistRouter)
  // Gate both the OpenAPI document and the Scalar UI on apiDocs; the UI fetches the spec, so gating only the UI would leave the full spec public.
  .use("/openapi.json", requireFeature("apiDocs"))
  .get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          version: BUILD_VERSION,
          title: site.name,
          description: site.apiReferenceDescription,
        },
      },
      exclude: OLD_PATHS_DOC,
      // Always-reachable errors (429/500) on every method the API serves; routes add 400/401 in their own responses. Add a method here the day a route starts using it, or its responses ship undocumented.
      defaultOptions: {
        DELETE: { responses: globalErrorResponses },
        GET: { responses: globalErrorResponses },
        PATCH: { responses: globalErrorResponses },
        POST: { responses: globalErrorResponses },
        PUT: { responses: globalErrorResponses },
      },
    }),
  )
  .use("/docs", requireFeature("apiDocs"))
  .get("/docs", apiReference)
  .use("/docs/scalar.js", requireFeature("apiDocs"))
  .get("/docs/scalar.js", serveScalarBundle)

export type AppType = typeof routes
export type {
  Agent,
  AgentsBoard,
  AgentState,
  CiState,
  Pull,
  PullProblem,
  PullsQueue,
  Report,
} from "@/lib/dashboard/agents"
export type {
  OpsFinding,
  OpsHealth,
  OpsLine,
  OpsReport,
  OpsReportRead,
} from "@/lib/apps/ops-report"
export type {
  Plan,
  PlanDone,
  PlanInFlight,
  PlanItem,
  PlanLanding,
  PlanLane,
  PlanRead,
} from "@/lib/apps/plan"
export type { PlanOrder } from "@/lib/apps/plan-order"
export type { AccountRow } from "@/lib/store/accounts"
export type { ExtensionRow } from "@/lib/store/extensions"
export type { Preview, PreviewKind } from "@/lib/apps/previews"
export type * from "@/plugins/registry"
export type { BatchAnswer, BatchOutcome, BatchRefusalCode } from "@/lib/batch"
export type { AttachmentKind, EntryAttachment } from "@/lib/dashboard/attachments"
export type { DashboardFrame } from "@/lib/dashboard/hub"
export type {
  InboxAction,
  InboxAttachment,
  InboxAttachmentKind,
  InboxDelivery,
  InboxDraft,
  InboxItem,
  InboxKind,
  InboxList,
  InboxPreview,
  InboxUpdate,
} from "@/lib/dashboard/inbox"
export type { OpsRow, OpsStatus } from "@/lib/dashboard/ops"
export type { RosterRole } from "@/lib/dashboard/roster"
export type { Entry, SessionTask } from "@/lib/dashboard/transcript"
export type { UsageLimit } from "@/lib/dashboard/unstick"
export type { WaitsOn, WorkPull, WorkQueue } from "@/lib/dashboard/work-queue"
export type { FeedItem, Light, Question, Role, Worker } from "@/lib/dashboard/workers"
export type { IdleStack, Limit } from "@/lib/system/capacity"
export type { Pressure } from "@/lib/system/parse"
export type { SystemAgent, SystemPoint, SystemReport, SystemStack } from "@/lib/system/sampler"
export type { Forecast, PrCost, Spend, UsageReport, WindowView } from "@/lib/usage/report"
export type { AccountUsage, Usage, UsageWindow } from "@/lib/usage/window"
export type { ZaiUsage, ZaiWindow } from "@/lib/usage/zai"
export type { ErrorCode } from "@/lib/error"
export type { EntryKind, SessionKind } from "@/lib/sessions/lines"

// Files a dashboard message carried leave the attachments folder a week after they arrive.
keepSweeping()

// The session the dashboard hosts on the Agent SDK, when PLAYGROUND_SDK_PROBE_DIR names its folder.
startSdkProbe()

// Yard's mentions of the owner into the Inbox, once a minute, when YARD_API_URL names a hosted Yard.
startYardPoll(db, yardClient)

mountOldPaths(routes, {
  apps: appsRouter,
  dashboard: dashboardRouter,
  inbox: inboxRouter,
  sessions: sessionsRouter,
})

// Bun.serve() shape locally and self-hosted, Node http.Server on Vercel; see @/lib/server.
export default createServer(app)
