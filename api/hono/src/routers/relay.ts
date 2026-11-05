import { sValidator } from "@hono/standard-validator"
import { pairKeySchema } from "@packages/message"
import { Hono, type MiddlewareHandler } from "hono"
import { describeRoute } from "hono-openapi"
import type { UpgradeWebSocket } from "hono/ws"
import { z } from "zod"

import {
  ApiError,
  authErrorResponses,
  errorResponse,
  forbiddenErrorResponses,
  validationErrorResponses,
} from "@/lib/error"
import type { Forwarded } from "@/lib/relay/hub"
import type { Hub } from "@/lib/relay/hub"
import { RELAY_PREFIX, relayAllowed } from "@/lib/relay/protocol"
import type { YardVariables } from "@/lib/yard/caller"

// The relay's hosted routes, inside Yard's router: the socket the owner's Mac holds with its own token, the Mac's status, the owner's browser's pair request, and its reads, each forwarded to the Mac with a fresh id and time, its answer passed back and kept nowhere. Every route takes the owner rung; a read also takes the hosted web's Origin when it names one, and its answer comes sandboxed and unsniffed, as the Mac's own files are.
export function relayRouter({
  hub,
  mac,
  owner,
  upgrade,
  webOrigin,
}: {
  hub: Hub
  mac: MiddlewareHandler<{ Variables: YardVariables }>
  owner: MiddlewareHandler<{ Variables: YardVariables }>
  upgrade: UpgradeWebSocket
  webOrigin: string | null
}) {
  const fromWeb: MiddlewareHandler = async (c, next) => {
    const origin = c.req.header("origin")
    if (origin !== undefined && origin !== webOrigin)
      throw new ApiError(403, "FORBIDDEN", "The relay reads from the hosted web alone")
    return next()
  }
  // the Mac's answer, or the 503 that says why there is none
  const online = (answer: Forwarded) => {
    if (answer.type === "offline") throw new ApiError(503, "MAC_OFFLINE", "Your Mac is offline")
    if (answer.type === "timeout")
      throw new ApiError(503, "MAC_OFFLINE", "Your Mac did not answer in time")
    return answer
  }
  return new Hono<{ Variables: YardVariables }>()
    .get(
      "/socket",
      describeRoute({
        description:
          "The owner's Mac holds this socket, opened with the owner's own yard_ token: the hub sends it each read the owner's browser makes, as a request frame, and it answers each with a response frame.",
        responses: {
          101: { description: "Switching Protocols" },
          ...authErrorResponses,
          ...forbiddenErrorResponses,
        },
        tags: ["Yard"],
      }),
      mac,
      async (c, next) => {
        if (c.get("caller").via !== "token")
          throw new ApiError(403, "FORBIDDEN", "Only the owner's Mac holds the relay")
        return next()
      },
      upgrade((c) => {
        const userId = c.get("caller").id
        // attach's own release, kept from onOpen, since onClose's context is a new object
        let release = () => {}
        return {
          onClose: () => release(),
          onMessage: (event, socket) => hub.answer(userId, String(event.data), socket),
          onOpen: (_, socket) => {
            release = hub.attach(userId, socket)
          },
        }
      }),
    )
    .get(
      "/status",
      describeRoute({
        description:
          "Whether the owner's Mac holds the relay, and since when it is offline when this instance saw it go",
        responses: {
          200: { description: "OK" },
          ...authErrorResponses,
          ...forbiddenErrorResponses,
        },
        tags: ["Yard"],
      }),
      owner,
      fromWeb,
      async (c) => c.json({ data: await hub.status(c.get("caller").id) }),
    )
    .post(
      "/pair",
      describeRoute({
        description:
          "Sends the owner's browser's public key to the owner's Mac as a pair request, which the owner approves on the Mac's own Settings; the Mac answers with the key's fingerprint, and pairs nothing until then",
        responses: {
          202: { description: "The Mac holds the request, with the key's fingerprint" },
          ...authErrorResponses,
          ...forbiddenErrorResponses,
          ...validationErrorResponses,
          503: errorResponse("MAC_OFFLINE", "Your Mac is offline"),
        },
        tags: ["Yard"],
      }),
      owner,
      fromWeb,
      sValidator("json", z.strictObject({ key: pairKeySchema }), (result) => {
        if (!result.success)
          throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", { issues: result.error })
      }),
      async (c) => {
        const caller = c.get("caller")
        const answer = online(await hub.pair(caller.id, caller.login, c.req.valid("json").key))
        return new Response(Buffer.from(answer.body, "base64"), {
          headers: { "cache-control": "no-store", "content-type": "application/json" },
          status: answer.status,
        })
      },
    )
    .get(
      "/api/*",
      describeRoute({
        description:
          "A read of the owner's own dashboard, answered by the owner's Mac through the relay: only the dashboard reads the relay carries (no first-run route and no write), refused with 503 while the Mac is offline",
        responses: {
          200: { description: "The Mac's answer" },
          ...authErrorResponses,
          ...forbiddenErrorResponses,
          503: errorResponse("MAC_OFFLINE", "Your Mac is offline"),
        },
        tags: ["Yard"],
      }),
      owner,
      fromWeb,
      async (c) => {
        const url = new URL(c.req.url)
        const target = `${url.pathname.slice(RELAY_PREFIX.length)}${url.search}`
        if (!relayAllowed(c.req.method, target))
          throw new ApiError(403, "FORBIDDEN", "The relay does not carry this request")
        const caller = c.get("caller")
        const answer = online(await hub.forward(caller.id, caller.login, target))
        return new Response(Buffer.from(answer.body, "base64"), {
          headers: {
            ...answer.headers,
            "cache-control": "no-store",
            "content-security-policy": "default-src 'none'; sandbox",
            "x-content-type-options": "nosniff",
          },
          status: answer.status,
        })
      },
    )
}
