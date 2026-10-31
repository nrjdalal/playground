"use client"

import type { MESSAGE_KINDS } from "@packages/message"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { unwrap } from "@/lib/api/client"
import { config } from "@/lib/config"
import { queryRetry } from "@/lib/query"
import { SOCKET_ROUTE, socketUrl, YARD_ROUTE, type YardChannel, type YardMessage } from "@/lib/yard"

export const CHANNELS_KEY = ["yard", "channels"] as const
export const messagesKey = (channel: string) => ["yard", "messages", channel] as const
export const TOKENS_KEY = ["yard", "tokens"] as const

// Every read and write goes to the API's Yard router with the session's cookie: the hosted API's own, or locally the routes that hold the Mac's Yard token.
async function yard<T>(path: string, init?: { body?: unknown; method?: string }): Promise<T> {
  const { data, error } = await unwrap(
    fetch(`${config.api.url}${YARD_ROUTE}${path}`, {
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "include",
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      method: init?.method ?? "GET",
    }) as Promise<{ ok: boolean; json: () => Promise<{ data: T }> }>,
  )
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data as T
}

export type YardToken = {
  createdAt: string
  id: string
  lastUsedAt: string | null
  name: string
  revokedAt: string | null
}

export const yardApi = {
  approve: (id: string) =>
    yard<{ message: YardMessage }>(`/messages/${id}/approve`, { method: "POST" }),
  channels: () => yard<{ channels: YardChannel[] }>("/channels"),
  createToken: (name: string) =>
    yard<{ token: YardToken & { secret: string } }>("/tokens", { body: { name }, method: "POST" }),
  deny: (id: string) => yard<{ message: YardMessage }>(`/messages/${id}/deny`, { method: "POST" }),
  message: (id: string) => yard<{ message: YardMessage }>(`/messages/${id}`),
  messages: (channel: string) =>
    yard<{ hasMore: boolean; messages: YardMessage[] }>(`/channels/${channel}/messages`),
  post: (channel: string, body: { kind: (typeof MESSAGE_KINDS)[number]; text: string }) =>
    yard<{ message: YardMessage }>(`/channels/${channel}/messages`, { body, method: "POST" }),
  read: (channel: string) =>
    yard<{ lastReadAt: string }>(`/channels/${channel}/read`, { body: {}, method: "POST" }),
  redeem: (code: string) =>
    yard<{ member: true }>("/invites/redeem", { body: { code }, method: "POST" }),
  requestInvite: (forLogin: string) =>
    yard<{ invite: unknown }>("/invites/request", { body: { forLogin }, method: "POST" }),
  revokeToken: (id: string) => yard<{ token: YardToken }>(`/tokens/${id}`, { method: "DELETE" }),
  tokens: () => yard<{ tokens: YardToken[] }>("/tokens"),
}

// The sidebar's channels and DMs; a stack with no Yard (the local routes absent) reads an error, and the groups stay away.
export const useYardChannels = () =>
  useQuery({
    queryFn: async () => (await yardApi.channels()).channels ?? [],
    queryKey: CHANNELS_KEY,
    retry: (count, error) =>
      (error as { code?: string }).code !== "NOT_FOUND" && queryRetry(count, error),
  })

export const useYardMessages = (channel: string) =>
  useQuery({
    queryFn: async () => (await yardApi.messages(channel)).messages ?? [],
    queryKey: messagesKey(channel),
  })

// One socket per signed-in tab: each frame lands in the query cache, and a closed socket (Vercel closes one at 800s) opens again with a fresh one-time token.
export function useYardSocket(enabled: boolean) {
  const client = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    let socket: WebSocket | null = null
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const open = async () => {
      try {
        const response = await fetch(`${config.api.url}/api/auth/one-time-token/generate`, {
          credentials: "include",
        })
        const { token } = (await response.json()) as { token: string }
        if (stopped) return
        socket = new WebSocket(socketUrl(config.api.url, SOCKET_ROUTE, token))
        socket.onmessage = (event) => {
          const frame = JSON.parse(String(event.data)) as { message?: YardMessage; type: string }
          if (frame.type === "message" && frame.message) {
            const message = frame.message
            client.setQueryData<YardMessage[]>(messagesKey(message.channel), (list) =>
              list ? [...list.filter((m) => m.id !== message.id), message] : list,
            )
          }
          void client.invalidateQueries({ queryKey: CHANNELS_KEY })
        }
        socket.onclose = () => {
          if (!stopped) retry = setTimeout(open, 2_000)
        }
      } catch {
        if (!stopped) retry = setTimeout(open, 5_000)
      }
    }
    void open()
    return () => {
      stopped = true
      clearTimeout(retry)
      socket?.close()
    }
  }, [client, enabled])
}
