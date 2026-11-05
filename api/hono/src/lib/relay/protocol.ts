import { pairKeySchema } from "@packages/message"
import { z } from "zod"

export { RELAY_PREFIX } from "@packages/message"

// The relay's words, read by both ends: the hosted hub, which forwards the owner's browser's reads, and this Mac, which answers them from its own dashboard. Pure, so the hosted build imports it with nothing that reads a machine.

// How old a forwarded request may be when this Mac reads it, so a frame replayed later does nothing.
export const RELAY_MAX_AGE_MS = 30_000

// How long the hub waits for this Mac's answer before it answers the browser itself.
export const RELAY_TIMEOUT_MS = 25_000

// How often this Mac tells the hub it is there, and how long a silent socket stays online: a sleeping Mac leaves its socket half-open, so the hub counts one silent for RELAY_SILENT_MS as gone.
export const RELAY_HEARTBEAT_MS = 15_000
export const RELAY_SILENT_MS = 45_000

// The dashboard's reads the relay carries, A to Z, every one a GET: no first-run or onboarding route (requireThisMachine is the only guard on the passwordless sign-in), no write, and no route on the never-from-Yard list. A write never goes here: it takes RELAY_WRITES, checked with the paired key by requireSignedWrite in mac.ts.
export const RELAY_GETS = [
  "/api/health",
  "/api/v1/agents",
  "/api/v1/apps/changelog",
  "/api/v1/apps/changelog/unread",
  "/api/v1/apps/previews",
  "/api/v1/attachments/:id",
  "/api/v1/board",
  "/api/v1/inbox",
  "/api/v1/inbox/attachments/:id",
  "/api/v1/ops",
  "/api/v1/sessions",
  "/api/v1/sessions/:id",
  "/api/v1/sessions/:id/entries",
  "/api/v1/sessions/:id/steps",
  "/api/v1/settings/:key",
  "/api/v1/stacks",
  "/api/v1/system",
  "/api/v1/threads",
  "/api/v1/threads/:id/messages",
  "/api/v1/workers",
  "/api/v1/workers/:sessionId/agents/:agentId/transcript",
  "/api/v1/workers/:sessionId/skills",
  "/api/v1/workers/:sessionId/transcript",
] as const

// An Inbox card's answer, the one write whose card's kind the Mac checks against RELAY_ANSWER_KINDS (`@packages/message`).
export const RELAY_ANSWER = "/api/v1/inbox/:id/answer"

const ANSWER_ROUTES = [RELAY_ANSWER]

// Pure: the card id a path on RELAY_ANSWER names, or null for any other path.
export const cardOf = (path: string): string | null =>
  pathOn(ANSWER_ROUTES, path) ? (path.split("?")[0]!.split("/")[4] ?? null) : null

// The dashboard's writes the relay carries, A to Z, every one a POST the owner's paired key signs: the composer's send, an Inbox card's answer (its Archive among them), and Later's schedule and Done's dismiss. No first-run, onboarding, delete, secret or settings route, and no route on the never-from-Yard list.
export const RELAY_WRITES = [
  RELAY_ANSWER,
  "/api/v1/inbox/:id/schedule",
  "/api/v1/inbox/dismiss",
  "/api/v1/messages",
] as const

// Each route as the pattern its path matches, made once per list.
const patterns = new WeakMap<readonly string[], RegExp[]>()
const patternsOf = (routes: readonly string[]): RegExp[] => {
  let made = patterns.get(routes)
  if (!made) {
    made = routes.map(
      (route) => new RegExp(`^${route.replace(/:[a-zA-Z]+/g, "[A-Za-z0-9._~-]+")}$`),
    )
    patterns.set(routes, made)
  }
  return made
}

// Pure: whether a target's path, its query aside, is one of routes as written, with no dot segment, encoded slash or backslash that a server might read as another path.
export function pathOn(routes: readonly string[], target: string): boolean {
  if (!target.startsWith("/")) return false
  const path = target.split("?")[0] ?? ""
  if (/%2f|%5c|\\/i.test(path) || path.split("/").some((part) => part === "." || part === ".."))
    return false
  return patternsOf(routes).some((pattern) => pattern.test(path))
}

// Pure: whether the relay carries a request: a GET on RELAY_GETS.
export const relayAllowed = (method: string, target: string): boolean =>
  method === "GET" && pathOn(RELAY_GETS, target)

// The hub's request to this Mac: a fresh id and the time it was sent, which the Mac checks before anything runs, and the signed-in owner's GitHub login.
export const relayRequestSchema = z.strictObject({
  at: z.iso.datetime(),
  id: z.uuid(),
  login: z.string().min(1).max(64),
  method: z.literal("GET"),
  path: z.string().min(1).max(2048),
  type: z.literal("request"),
})
export type RelayRequest = z.infer<typeof relayRequestSchema>

// The hub's pair request to this Mac: the owner's browser's public key, which waits on the Mac until the owner approves it there, with the same fresh id and time as a request.
export const relayPairSchema = z.strictObject({
  at: z.iso.datetime(),
  id: z.uuid(),
  key: pairKeySchema,
  login: z.string().min(1).max(64),
  type: z.literal("pair"),
})
export type RelayPair = z.infer<typeof relayPairSchema>

// A write from Yard, signed in the owner's browser by the paired key over signedBytes (@packages/message): its body is the JSON as sent, and keyId names the key that signed it.
export const relayWriteSchema = z.strictObject({
  at: z.iso.datetime(),
  body: z.string().max(65_536),
  id: z.uuid(),
  keyId: z.string().min(1).max(64),
  login: z.string().min(1).max(64),
  method: z.literal("POST"),
  path: z.string().min(1).max(2048),
  sig: z.string().min(1).max(128),
  type: z.literal("write"),
})
export type RelayWrite = z.infer<typeof relayWriteSchema>

// The answer's headers the relay carries, A to Z: a file's type and name; the hub sets its own no-store, sandbox and nosniff on every answer.
export const RELAY_HEADERS = ["content-disposition", "content-type"] as const

// This Mac's answer: the status, the headers on RELAY_HEADERS, and the body as base64, so a file reads as it is.
export const relayResponseSchema = z.strictObject({
  body: z.string(),
  headers: z.strictObject({
    "content-disposition": z.string().max(1024).optional(),
    "content-type": z.string().max(256).optional(),
  }),
  id: z.uuid(),
  status: z.number().int().min(100).max(599),
  type: z.literal("response"),
})
export type RelayResponse = z.infer<typeof relayResponseSchema>

// This Mac's frame every RELAY_HEARTBEAT_MS, so the hub knows the socket still answers.
export const relayHeartbeatSchema = z.strictObject({ type: z.literal("heartbeat") })

// What the hosted web reads before it draws the dashboard: whether this Mac holds its socket, and since when it is offline, when that is known.
export type RelayStatus = { online: boolean; since: string | null }
