import { dirname } from "node:path"

import { z } from "zod"

import { defineSettings, type Settings } from "@/settings"

// Where the factory's code lives, empty until set, so no default names a person's folder.
export const pathsSettings = defineSettings({
  "paths.codeRoot": {
    default: "",
    description:
      "The folder that holds your code, the folder that holds the checkout when unset: spawn.sh answers Claude's folder trust prompt there and moves a session off the Desktop into it.",
    schema: z.string().regex(/^(?:\/.*)?$/, "an absolute path, or empty for unset"),
  },
})

// The code root: paths.codeRoot when set, else the folder that holds the checkout.
export const codeRoot = (settings: Settings, checkout: string): string =>
  pathsSettings.get(settings, "paths.codeRoot") || dirname(checkout)
