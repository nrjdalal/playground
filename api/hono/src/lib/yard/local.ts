import type { z } from "zod"

import { ApiError } from "@/lib/error"
import { type pageSchema, type postSchema, type YardClient, YardError } from "@/lib/yard/client"
import { type Card, pendingCard } from "@/lib/yard/inbound"
import type { Keychain } from "@/lib/yard/keychain"

// What the local `/api/v1/yard/*` routes do (routers/yard-local.ts): each calls the hosted Yard with the Mac's token from the Keychain, so the browser never holds it.

export type LocalYardDeps = {
  api: string | undefined
  card: (card: Card) => Promise<void>
  client: (base: string, token: string) => YardClient
  keychain: Keychain
  web: string | undefined
}

// Off and signed out both answer 404, so the local sidebar hides its Yard groups and asks nothing again.
const OFF = "Yard is not set up on this Playground: set YARD_API_URL"
const SIGNED_OUT = "Yard has no token on this Mac: sign in with playground yard login"

// A Yard refusal as the local API's own, so the web reads one envelope: Yard's 401 means the Keychain's token no longer works.
const relay = (error: unknown): never => {
  if (!(error instanceof YardError)) throw error
  if (error.status === 401) throw new ApiError(404, "NOT_FOUND", SIGNED_OUT)
  if (error.status === 403) throw new ApiError(403, "FORBIDDEN", error.message)
  if (error.status === 404) throw new ApiError(404, "NOT_FOUND", error.message)
  if (error.status === 400) throw new ApiError(400, "VALIDATION_ERROR", error.message)
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
    // A post Yard holds pending puts an Inbox card up whose Approve opens Yard's approve page.
    post: (channel: string, post: z.infer<typeof postSchema>) =>
      call(async (client) => {
        const message = await client.post(channel, post)
        if (message.status === "pending" && deps.web) {
          const found = (await client.channels()).find((c) => c.id === channel)
          if (found) await deps.card(pendingCard(message, found, deps.web))
        }
        return { message }
      }),
    read: (channel: string) => call((client) => client.read(channel)),
    status: async () => {
      if (!deps.api) return { login: null, setUp: false, signedIn: false }
      const token = await deps.keychain.read()
      if (!token) return { login: null, setUp: true, signedIn: false }
      const me = await deps
        .client(deps.api, token)
        .me()
        .catch(() => null)
      return { login: me?.login ?? null, setUp: true, signedIn: me !== null }
    },
  }
}
