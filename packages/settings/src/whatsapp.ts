import { z } from "zod"

// By relative path, as slack.ts imports, since the API's inbox, which the CLI runs from any shell, imports this file.
import { defineSettings } from "./settings"

const e164 = z
  .string()
  .regex(/^(?:\+[1-9]\d{7,14})?$/, "a phone number is + and 8 to 15 digits, as +15550100001")

// How the factory reaches WhatsApp: the spare number ops-wa links to, the owner's number, the allowlist of one that gives orders, and an alert-only second number; ops-wa links and hands on nothing until the first two are set.
export const whatsappSettings = defineSettings({
  "wa.alert": {
    default: "",
    description:
      "A second WhatsApp number in E.164 that gets alerts alone: each playground wa alert goes to it once, beside the owner's number, and its messages reach the dispatcher as data, never an order or an Inbox answer. Empty sends alerts to the owner alone.",
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
  "wa.owner": {
    default: "",
    description:
      "The owner's WhatsApp number in E.164, the allowlist of one: ops-wa hands on only this number's 1:1 messages as the owner's and sends replies only to it; ops-wa does not run until it is set.",
    masked: true,
    schema: e164,
  },
})
