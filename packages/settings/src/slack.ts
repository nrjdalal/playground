import { z } from "zod"

// By relative path, as settings.ts imports, since the API's inbox, which the CLI runs from any shell, imports this file.
import { defineSettings } from "./settings"

// How the factory reaches Slack: the owner's DM and Slack mode, the converter that rewrites an archives link to its app form, and the MCP server a sent message goes through; none until set, and the Inbox's instructions then name neither.
export const slackSettings = defineSettings({
  "slack.dmChannel": {
    default: "",
    description:
      "The Slack id of the owner's own DM, which the DM watch reads and playground dm send posts to; neither runs until it is set.",
    schema: z.string().regex(/^(?:D[A-Z0-9]+)?$/, "a Slack DM id"),
  },
  "slack.dmOwner": {
    default: "",
    description:
      "The owner's Slack member id: the DM watch hands on only this member's messages, and dm send posts as this member; neither runs until it is set.",
    schema: z.string().regex(/^(?:[UW][A-Z0-9]+)?$/, "a Slack member id"),
  },
  "slack.linkConverter": {
    default: "",
    description:
      "The command an agent pipes a Slack archives link through to get its app form, which the Inbox's link refusal and a draft's instructions name; none when empty.",
    schema: z.string(),
  },
  "slack.mode": {
    default: false,
    description:
      "Slack mode: the owner is away and the DM is the owner's remote access, so the DM watch hands each owner message to the dispatcher, nudges it for an update every 15 minutes and fails over to the second dispatcher; off until the owner turns it on, on until the owner turns it off.",
    schema: z.boolean(),
  },
  "slack.sendServer": {
    default: "",
    description:
      "The MCP server a sent Slack message goes through, which the Inbox names when the dispatcher carries out an ended poster's send; your Slack tool when empty.",
    schema: z.string(),
  },
})
