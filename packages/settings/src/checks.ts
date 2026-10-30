import { z } from "zod"

import { defineSettings } from "@/settings"

// The authors from outside the factory whose PRs Checks runs, each only at a head the Builder gave its go: none until set.
export const checksSettings = defineSettings({
  "checks.outsideAuthors": {
    default: [],
    description:
      "The GitHub logins outside the factory whose PRs Checks runs, each only at a head the Builder gave its go, since Checks runs a PR's code on this machine and the runner box.",
    schema: z.array(z.string().regex(/^[A-Za-z0-9-]+$/, "a GitHub login")),
  },
})
