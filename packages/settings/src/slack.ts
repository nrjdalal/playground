import { z } from "zod"

// By relative path, as settings.ts imports, since the API's inbox, which the CLI runs from any shell, imports this file.
import { defineSettings } from "./settings"

// How the factory reaches the org's Slack: the converter that rewrites an archives link to its app form, and the MCP server a sent message goes through; none until set, and the Inbox's instructions then name neither.
export const slackSettings = defineSettings({
  "slack.linkConverter": {
    default: "",
    description:
      "The command an agent pipes a Slack archives link through to get its app form, which the Inbox's link refusal and a draft's instructions name; none when empty.",
    schema: z.string(),
  },
  "slack.sendServer": {
    default: "",
    description:
      "The MCP server a sent Slack message goes through, which the Inbox names when the dispatcher carries out an ended poster's send; your Slack tool when empty.",
    schema: z.string(),
  },
})
