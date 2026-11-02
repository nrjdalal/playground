import { z } from "zod"

import { defineSettings } from "@/settings"

// The shared channel the channel watch relays to the dispatcher, and the member whose own posts it skips: neither until set.
export const channelSettings = defineSettings({
  "channel.skipUser": {
    default: "",
    description:
      "The Slack member id whose own posts the channel watch skips, the account it posts as; none until set.",
    schema: z.string().regex(/^(?:[UW][A-Z0-9]+)?$/, "a Slack member id"),
  },
  "channel.slackId": {
    default: "",
    description:
      "The Slack channel id of the shared channel the channel watch relays to the dispatcher; once the watch is on, each pass fails by name while it is unset.",
    schema: z.string().regex(/^(?:[CG][A-Z0-9]+)?$/, "a Slack channel id"),
  },
})
