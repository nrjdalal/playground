import { type ConsoleRole, roleAtLeast } from "@packages/auth/access"
import type { Message } from "@packages/message"

import { countLabel } from "@/components/dashboard/count-badge"

// A channel or DM as GET /api/v1/yard/channels gives it (H3's contract): a DM names its other member in peer, a channel has none.
export type YardChannel = {
  id: string
  kind: "channel" | "dm"
  lastMessageAt: string | null
  mentions: number
  name: string
  peer: { id: string; image: string | null; login: string; name: string } | null
  postRule: "members" | "owner"
  topic: string | null
  unread: number
}

export type YardMessage = Message & { parent?: string; status?: "denied" | "pending" | "sent" }

export const YARD_ROUTE = "/api/v1/yard"
export const SOCKET_ROUTE = `${YARD_ROUTE}/socket`

// The socket goes straight to the API host, since the web's /api rewrite does not forward an upgrade; the one-time token rides the query, as a browser's WebSocket sets no header.
export const socketUrl = (api: string, route: string, token: string) =>
  `${api.replace(/^http/, "ws")}${route}?token=${encodeURIComponent(token)}`

// The hosted app opens a channel under /yard; the local dashboard opens it in its own chat pane.
export const channelHref = (channel: Pick<YardChannel, "id">, hosted: boolean) =>
  hosted ? `/yard/c/${channel.id}` : `/dashboard/yard/${channel.id}`

// Approving needs Yard's own web session, so a local stack, which serves no /yard page, links nowhere.
export const approveHref = (message: Pick<YardMessage, "id">, hosted: boolean) =>
  hosted ? `/yard/approve/${message.id}` : null

export const channelTitle = (channel: Pick<YardChannel, "kind" | "name" | "peer">) =>
  channel.kind === "dm" ? (channel.peer?.login ?? "Direct message") : `#${channel.name}`

// The sidebar's two groups, each in the API's order.
export const yardGroups = (channels: YardChannel[]) => ({
  channels: channels.filter((channel) => channel.kind === "channel"),
  dms: channels.filter((channel) => channel.kind === "dm"),
})

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
