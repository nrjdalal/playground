import { type ConsoleRole, roleAtLeast } from "@packages/auth/access"
import { approvePath, type Channel, type Message } from "@packages/message"
import type { QueryClient } from "@tanstack/react-query"

import { countLabel } from "@/components/dashboard/count-badge"

// A channel or DM and a message as the Yard API sends them, in the shapes the server checks them by (packages/message).
export type YardChannel = Channel
export type YardMessage = Message

export const YARD_ROUTE = "/api/v1/yard"

// Every Yard read's query key starts here, so one invalidation reads them all again.
export const YARD_KEY = ["yard"] as const
export const messagesKey = (channel: string) => [...YARD_KEY, "messages", channel] as const

// A socket that opens again may have missed messages while it was down, or, with no shared store, sent through another of the API's instances: the reads on screen are read again.
export const catchUp = (client: Pick<QueryClient, "invalidateQueries">) =>
  client.invalidateQueries({ queryKey: YARD_KEY })

// The open channel's messages, read again every 30 seconds while its tab shows (React Query pauses it in a hidden one), so a message the socket missed shows within that while no shared store fans one out across the API's instances.
export const messagesQuery = (channel: string, read: () => Promise<Message[]>) => ({
  queryFn: read,
  queryKey: messagesKey(channel),
  refetchInterval: 30_000,
})
export const SOCKET_ROUTE = `${YARD_ROUTE}/socket`

// The socket opens on the API's own host, NEXT_PUBLIC_API_URL, never config.api.url, which on a public hosting suffix is the web's origin behind its /api rewrite, and the rewrite forwards no upgrade; the one-time token rides the query, as a browser's WebSocket sets no header.
export const socketUrl = (env: { NEXT_PUBLIC_API_URL: string }, token: string) =>
  `${env.NEXT_PUBLIC_API_URL.replace(/^http/, "ws")}${SOCKET_ROUTE}?token=${encodeURIComponent(token)}`

// A closed socket's next try waits 2s, doubling with each try that fails to a minute, so a tab whose socket keeps failing settles at one try a minute.
export const retryDelay = (tries: number) => Math.min(2_000 * 2 ** tries, 60_000)

// A message that arrives twice, from the socket and a post's own answer, stays once, in the API's order by its time (a post approved later moves to the time it was sent).
export const upsertMessage = (list: Message[], message: Message) =>
  [...list.filter((row) => row.id !== message.id), message].sort((a, b) => a.at.localeCompare(b.at))

// The hosted app opens a channel under /yard; the local dashboard opens it in its own chat pane.
export const channelHref = (channel: Pick<YardChannel, "id">, hosted: boolean) =>
  hosted
    ? `/yard/c/${encodeURIComponent(channel.id)}`
    : `/dashboard/yard/${encodeURIComponent(channel.id)}`

// Approving needs Yard's own web session, so a local stack, which serves no /yard page, links nowhere.
export const approveHref = (message: Pick<YardMessage, "id">, hosted: boolean) =>
  hosted ? approvePath(message.id) : null

export const channelTitle = (channel: Pick<YardChannel, "kind" | "name" | "peer">) =>
  channel.kind === "dm" ? (channel.peer?.login ?? "Direct message") : `#${channel.name}`

// The sidebar's two groups, each in the API's order: the channels you have joined (the API lists every one), and every DM.
export const yardGroups = (channels: YardChannel[]) => ({
  channels: channels.filter((channel) => channel.kind === "channel" && channel.joined),
  dms: channels.filter((channel) => channel.kind === "dm"),
})

// Where /yard lands: the sidebar's first row, a joined channel, else a DM, never a channel you have not joined, whose messages the API refuses you.
export const landingChannel = (channels: YardChannel[]) => {
  const { channels: joined, dms } = yardGroups(channels)
  return joined[0] ?? dms[0] ?? null
}

// A row's badge: its unread count as the Threads rows read it, in the mention colour while any of them names you, and none once read.
export const yardBadge = (channel: Pick<YardChannel, "mentions" | "unread">) =>
  channel.unread > 0 ? { label: countLabel(channel.unread), mention: channel.mentions > 0 } : null

// Who may write in a channel: an owner-only channel (#releases) takes the owner rung's posts alone.
export const canPost = (channel: Pick<YardChannel, "postRule">, role: string | null | undefined) =>
  channel.postRule === "members" || roleAtLeast(role, "owner")

// Where a visit to the hosted app lands: signed out, the home's Sign in with GitHub; signed in below the member rung, the invite page; a member, the app.
export type YardGate = "app" | "invite" | "sign-in"
export const yardGate = (user: { role?: string | null } | null | undefined): YardGate =>
  !user ? "sign-in" : roleAtLeast(user.role, "member" satisfies ConsoleRole) ? "app" : "invite"

// The invite requests that wait on the owner, each opened on its own page.
export const inviteRequests = <T extends { status: string }>(invites: T[]) =>
  invites.filter((invite) => invite.status === "requested")
