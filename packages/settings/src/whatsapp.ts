import { z } from "zod"

// By relative path, as slack.ts imports, since the API's inbox, which the CLI runs from any shell, imports this file.
import { defineSettings } from "./settings"

// What every policy line holds until the owner sets one: factory status, with no secret and no customer's personal data.
export const DEFAULT_POLICY = "factory status; no secrets or customer personal data"
const policy = z.string().trim().min(1).max(400)

const e164 = z
  .string()
  .regex(/^(?:\+[1-9]\d{7,14})?$/, "a phone number is + and 8 to 15 digits, as +15550100001")

// How the factory reaches WhatsApp: the spare number ops-wa links to, the owner's number, the allowlist of one that gives orders, and a second number that gets alerts and chats as a guest; ops-wa links and hands on nothing until the first two are set.
export const whatsappSettings = defineSettings({
  "wa.alert": {
    default: "",
    description:
      "A second WhatsApp number in E.164, a guest: each playground wa alert goes to it once, beside the owner's number, the dispatcher replies to it with playground wa send --to alert, and its messages reach the dispatcher as data, never an order or an Inbox answer. Empty sends alerts to the owner alone.",
    masked: true,
    schema: e164,
  },
  "wa.device": {
    default: "",
    description:
      "The spare number ops-wa links to as a device, in E.164: its pairing code is for this number. Never the owner's own number; ops-wa does not run until it is set.",
    masked: true,
    schema: e164,
  },
  "wa.guestPolicy": {
    default: DEFAULT_POLICY,
    description:
      "What the dispatcher may answer the wa.alert number, a guest, with: the policy line ops-wa adds to each of its messages. A guard key, set by the owner alone.",
    schema: policy,
  },
  "wa.owner": {
    default: "",
    description:
      "The owner's WhatsApp number in E.164, the allowlist of one: ops-wa hands on only this number's 1:1 messages as the owner's and sends replies only to it; ops-wa does not run until it is set.",
    masked: true,
    schema: e164,
  },
  "wa.replyPolicy": {
    default: DEFAULT_POLICY,
    description:
      "What the dispatcher may answer the owner's WhatsApp with: the policy line ops-wa adds to each message it hands on and to each update it asks for. A guard key, set by the owner alone.",
    schema: policy,
  },
})
