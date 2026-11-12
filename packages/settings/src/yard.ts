import { z } from "zod"

// By relative path, as live.ts imports, since a test outside the package imports this file.
import { defineSettings } from "./settings"

// The bots this Mac answers a read of the dispatcher's log for, each by its Yard login, botLogin's <name>[bot] (@packages/message); playground yard bot add --log adds one and bot revoke takes it off.
export const yardSettings = defineSettings({
  "yard.logReaders": {
    default: [] as string[],
    description:
      "The bots whose read of the dispatcher's log this Mac answers through the relay, each by its Yard login; a bot Yard lets read the log reads nothing until its login is here.",
    schema: z.array(
      z.string().regex(/^[a-z\d][a-z\d-]{0,29}\[bot\]$/, "a bot's login, <name>[bot]"),
    ),
  },
})
