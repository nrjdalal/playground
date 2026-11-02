import { z } from "zod"

// By relative path, as settings.ts imports, since the API's inbox, which the CLI runs from any shell, imports this file.
import { defineSettings } from "./settings"

// One line that never reads as a flag; empty while unset.
const argValue = (separator = "") =>
  z
    .string()
    .regex(
      new RegExp(`^(?:[^-\\s${separator}][^\\r\\n${separator}]*)?$`),
      `one line that does not start with a dash${separator ? ` or hold a ${separator}` : ""}`,
    )

// Where a secret ask's 1Password sink saves a value: a vault and a tag, kept in the owner's private settings so the repo names neither; the sink refuses to run until both are set.
export const onePasswordSettings = defineSettings({
  "onePassword.tag": {
    default: "",
    description:
      "The tag a secret ask's 1Password sink puts on each item it saves, which a reader of those items finds them by; the sink refuses to run until it and onePassword.vault are set.",
    schema: argValue(","),
  },
  "onePassword.vault": {
    default: "",
    description:
      "The 1Password vault, by name or id, a secret ask's 1Password sink saves each value to as a new item titled with the ask's key; the sink refuses to run until it and onePassword.tag are set.",
    schema: argValue(),
  },
})
