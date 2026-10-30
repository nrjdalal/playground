import { z } from "zod"

import { defineSettings } from "@/settings"

const repo = z
  .string()
  .regex(/^(?:[A-Za-z0-9-]+\/[A-Za-z0-9._-]+)?$/, "a repository as owner/name, or empty for unset")

// The repositories the factory works in, each empty until set, so no default names one: where its pull requests land (unset, the checkout's origin), the public one its guards keep private text out of, and the archive the trace ratchet counts links to (unset, the guard and the ratchet keep today's two, until the switch sets both).
export const factorySettings = defineSettings({
  "factory.archiveRepo": {
    default: "",
    description:
      "The archive repository: a link to it is private history, so the trace ratchet counts it and no-public-leak refuses it in a public write.",
    schema: repo,
  },
  "factory.publicRepo": {
    default: "",
    description:
      "The public repository: no-public-leak refuses a write there that holds private text, and the trace ratchet reads past its own name.",
    schema: repo,
  },
  "factory.repo": {
    default: "",
    description:
      "The repository the factory's pull requests land in, the checkout's origin when unset: pr:merge needs GitGuardian's check there, Checks reads its PRs, and the roster links a bare PR number into it.",
    schema: repo,
  },
})
