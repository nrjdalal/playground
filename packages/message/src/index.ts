import { z } from "zod"

// What a message is for, so an agent reads it the same way every time.
export const MESSAGE_KINDS = [
  "answer",
  "bug",
  "fix",
  "log",
  "notice",
  "question",
  "steps",
  "text",
] as const

export const MAX_TEXT = 4000

// How long a message is kept before the API's daily sweep deletes it (the owner's #i6); the web says so on an empty channel.
export const RETENTION_DAYS = 90

// A message's state: sent to the channel, or a tier-two post pending its sender's approval, or denied.
export const MESSAGE_STATUSES = ["denied", "pending", "sent"] as const

// The device a post came from: the name of the token it was made with, never the token itself, which starts yard_ and must never travel in a message, or WEB_DEVICE for a post from a signed-in browser.
const device = z
  .string()
  .min(1)
  .max(64)
  .refine((name) => !name.startsWith("yard_"), "a device name, never a token")

export const WEB_DEVICE = "web"

// Where the hosted web approves what waits on you, built in one place for every link to it: a pending message's sender sends or denies it, and the owner opens or denies an invite request.
export const approvePath = (messageId: string) => `/yard/approve/${encodeURIComponent(messageId)}`
export const invitePath = (inviteId: string) => `/yard/invites/${encodeURIComponent(inviteId)}`

// A token's name, which a post made with it carries as from.device, so none may take the browser's name.
export const tokenNameSchema = device.refine(
  (name) => name !== WEB_DEVICE,
  `${WEB_DEVICE} is the browser's name, not a token's`,
)

// A GitHub login as Yard takes one for a DM or an invite, checked alike by the API and the web's forms.
export const githubLoginSchema = z
  .string()
  .trim()
  .regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i, "a GitHub login")

// An invite code as a newcomer types it, the one shape the redeem route takes.
export const inviteCodeSchema = z.string().trim().min(1, "the invite code").max(64)

// One message as the server stores and sends it: the server stamps from and at; channel is the channel's id, parent the message a reply answers, and a message with no status is sent.
export const messageSchema = z.object({
  at: z.iso.datetime(),
  channel: z.string().min(1),
  from: z.object({ device, login: z.string().min(1).max(39) }),
  id: z.string().min(1),
  kind: z.enum(MESSAGE_KINDS),
  links: z
    .array(z.url({ protocol: /^https?$/ }).max(2000))
    .max(10)
    .optional(),
  parent: z.string().min(1).optional(),
  status: z.enum(MESSAGE_STATUSES).optional(),
  text: z.string().min(1).max(MAX_TEXT),
})

export type Message = z.infer<typeof messageSchema>

// One channel or DM as a member sees it: a DM is named dm:<user id>:<user id> and shows as its peer, the other member; unread and mentions count sent messages since the member last read it.
export const channelSchema = z.object({
  id: z.string().min(1),
  joined: z.boolean(),
  kind: z.enum(["channel", "dm"]),
  lastMessageAt: z.iso.datetime().nullable(),
  mentions: z.number().int().min(0),
  name: z.string().min(1),
  peer: z
    .object({ id: z.string(), image: z.string().nullable(), login: z.string(), name: z.string() })
    .nullable(),
  postRule: z.enum(["members", "owner"]),
  topic: z.string().nullable(),
  unread: z.number().int().min(0),
})

export type Channel = z.infer<typeof channelSchema>
