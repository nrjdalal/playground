import { z } from "zod"

import { readPolicyOrDefaults } from "@/rendered"
import { defineSettings } from "@/settings"

const name = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "a session name, lowercase words joined by hyphens")
const manager = z.enum(["builder", "dispatcher", "ops", "planner"])

// The managers' session names, so a factory names its own: each kind's name, and the old names a machine's sessions and stored rows still carry, each read as its kind.
export const sessionSettings = defineSettings({
  "sessions.aliases": {
    default: {},
    description:
      "Old names of the managers' sessions, each mapped to its kind, so a session or a stored row under one still reads as that kind.",
    schema: z.record(name, manager),
  },
  "sessions.names": {
    default: { builder: "builder", dispatcher: "dispatcher", ops: "ops", planner: "planner" },
    description:
      "The session name each manager kind starts under; the second dispatcher takes the dispatcher's with -2.",
    schema: z.strictObject({ builder: name, dispatcher: name, ops: name, planner: name }),
  },
})

// The machine's managers' names, as @packages/config/kinds' setSessionNames takes them: the defaults until a first setting writes policy.json; a policy that is there and cannot be read is a refusal, never the defaults.
export const readSessionNames = (data: string) => {
  const read = readPolicyOrDefaults(data)
  if (read.refusal !== undefined) throw new Error(read.refusal)
  return {
    aliases: sessionSettings.get(read.settings, "sessions.aliases"),
    names: sessionSettings.get(read.settings, "sessions.names"),
  }
}
