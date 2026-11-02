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

// The device a post came from: the name of the token it was made with, never the token itself, which starts yard_ and must never travel in a message, or WEB_DEVICE for a post from a signed-in browser.
const device = z
  .string()
  .min(1)
  .refine((name) => !name.startsWith("yard_"), "a device name, never a token")

export const WEB_DEVICE = "web"

// A token's name, which a post made with it carries as from.device, so none may take the browser's name.
export const tokenNameSchema = device.refine(
  (name) => name !== WEB_DEVICE,
  `${WEB_DEVICE} is the browser's name, not a token's`,
)

// One message as the server stores and sends it: the server stamps from and at.
export const messageSchema = z.object({
  at: z.iso.datetime(),
  channel: z.string().min(1),
  from: z.object({ device, login: z.string().min(1) }),
  id: z.string().min(1),
  kind: z.enum(MESSAGE_KINDS),
  links: z.array(z.url({ protocol: /^https?$/ })).optional(),
  text: z.string().min(1).max(MAX_TEXT),
})

export type Message = z.infer<typeof messageSchema>
