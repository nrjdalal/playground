import { z } from "zod"

export { RELAY_PREFIX } from "@packages/message"

// The relay's words, read by both ends: the hosted hub, which forwards the owner's browser's reads, and this Mac, which answers them from its own dashboard. Pure, so the hosted build imports it with nothing that reads a machine.

// How old a forwarded request may be when this Mac reads it, so a frame replayed later does nothing.
export const RELAY_MAX_AGE_MS = 30_000

// How long the hub waits for this Mac's answer before it answers the browser itself.
export const RELAY_TIMEOUT_MS = 25_000

// The dashboard's reads the relay carries, A to Z, every one a GET: no first-run or onboarding route (requireThisMachine is the only guard on the passwordless sign-in), no write, and no route on the never-from-Yard list. A write is added here by name, once a paired key signs it.
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

const PATTERNS = RELAY_GETS.map(
  (route) => new RegExp(`^${route.replace(/:[a-zA-Z]+/g, "[A-Za-z0-9._~-]+")}$`),
)

// Pure: whether the relay carries a request: a GET whose path, its query aside, is one of RELAY_GETS as written, with no dot segment, encoded slash or backslash that a server might read as another path.
export function relayAllowed(method: string, target: string): boolean {
  if (method !== "GET" || !target.startsWith("/")) return false
  const path = target.split("?")[0] ?? ""
  if (/%2f|%5c|\\/i.test(path) || path.split("/").some((part) => part === "." || part === ".."))
    return false
  return PATTERNS.some((pattern) => pattern.test(path))
}

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

// This Mac's answer: the status, the content type, and the body as base64, so a file reads as it is.
export const relayResponseSchema = z.strictObject({
  body: z.string(),
  contentType: z.string().max(256).nullable(),
  id: z.uuid(),
  status: z.number().int().min(100).max(599),
  type: z.literal("response"),
})
export type RelayResponse = z.infer<typeof relayResponseSchema>

// What the hosted web reads before it draws the dashboard: whether this Mac holds its socket, and since when it is offline, when that is known.
export type RelayStatus = { online: boolean; since: string | null }
