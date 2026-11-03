import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { z } from "zod"

import { ApiError, type ErrorCode } from "@/lib/error"
import { type pageSchema, type postSchema, type YardClient, YardError } from "@/lib/yard/client"
import type { Keychain } from "@/lib/yard/keychain"

// What the local `/api/v1/yard/*` routes do (routers/yard-local.ts): each calls the hosted Yard with the Mac's token from the Keychain, so the browser never holds it.

export type LocalYardDeps = {
  api: string | undefined
  client: (base: string, token: string) => YardClient
  keychain: Keychain
}

// Off and signed out both answer 404, so the local sidebar hides its Yard groups and asks nothing again.
const OFF = "Yard is not set up on this Playground: set YARD_API_URL"
const SIGNED_OUT = "Yard has no token on this Mac: sign in with playground yard login"

// The Yard refusals the local API passes on as its own, so the composer says what Yard said; any other is a 502.
const PASSED: Partial<Record<number, ErrorCode>> = {
  400: "VALIDATION_ERROR",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "TOO_MANY_REQUESTS",
}

// A Yard refusal as the local API's own, so the web reads one envelope: Yard's 401 means the Keychain's token no longer works.
const relay = (error: unknown): never => {
  if (!(error instanceof YardError)) throw error
  if (error.status === 401) throw new ApiError(404, "NOT_FOUND", SIGNED_OUT)
  const code = PASSED[error.status]
  if (code) throw new ApiError(error.status as ContentfulStatusCode, code, error.message)
  throw new ApiError(502, "INTERNAL_SERVER_ERROR", `Yard: ${error.message}`)
}

export const localYard = (deps: LocalYardDeps) => {
  const signedIn = async (): Promise<YardClient> => {
    if (!deps.api) throw new ApiError(404, "NOT_FOUND", OFF)
    const token = await deps.keychain.read()
    if (!token) throw new ApiError(404, "NOT_FOUND", SIGNED_OUT)
    return deps.client(deps.api, token)
  }
  const call = async <T>(run: (client: YardClient) => Promise<T>): Promise<T> =>
    run(await signedIn()).catch(relay)
  return {
    channels: () => call(async (client) => ({ channels: await client.channels() })),
    messages: (channel: string, page: z.infer<typeof pageSchema>) =>
      call((client) => client.messages(channel, page)),
    // a post Yard holds pending reaches the Inbox through the poll (inbound.ts), as one held from the terminal does
    post: (channel: string, post: z.infer<typeof postSchema>) =>
      call(async (client) => ({ message: await client.post(channel, post) })),
    read: (channel: string) => call((client) => client.read(channel)),
  }
}
