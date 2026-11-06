import type { RosterKind } from "@packages/config/kinds"
import { z } from "zod"

import { readPolicyOrDefaults } from "@/rendered"
import { defineSettings } from "@/settings"

const name = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "a session name, lowercase words joined by hyphens")
const manager = z.enum(["builder", "dispatcher", "ops", "planner"])

// The manager kinds a template starts, each a lead in a workspace of its own through spawn.sh's manager mode: ROSTER_ROLE_OF_KIND's managers, written out since settings reads no package at run time but its own deps.
export const TEMPLATE_KINDS = [
  "assistant",
  "builder",
  "dispatcher",
  "ops",
  "optimizer",
  "orchestrator",
  "planner",
] as const satisfies readonly RosterKind[]

// The efforts spawn.sh takes, Claude Code's levels.
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const

// A brief is one file's name, under the data folder or scripts/briefs, so no template reaches outside either.
export const BRIEF_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// One template the sidebar's plus starts a session from: every value checked here, so none reaches spawn.sh's argv unread. account is a usage.accounts email, Claude alone; none takes the first account that is not this machine's own login, for a second dispatcher, which spawn.sh never starts on the first's.
export const sessionTemplate = z
  .strictObject({
    account: z.string().email().optional(),
    backend: z.enum(["claude", "glm"]),
    brief: z
      .string()
      .regex(BRIEF_NAME, "a brief is a file name, with no /")
      .refine((brief) => !brief.includes(".."), "a brief is a file name, with no .."),
    effort: z.enum(EFFORTS).optional(),
    id: name,
    kind: z.enum(TEMPLATE_KINDS),
    label: z.string().min(1).max(40),
    model: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]*$/, "a model id")
      .optional(),
  })
  .refine(
    (t) =>
      t.backend === "claude" ||
      (t.account === undefined && t.effort === undefined && t.model === undefined),
    {
      message:
        "a GLM template runs on models.glm and its first GLM row, so it takes no account, effort or model",
    },
  )

export type SessionTemplate = z.infer<typeof sessionTemplate>

// The setting's list, each id once.
export const sessionTemplates = z
  .array(sessionTemplate)
  .refine(
    (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    "each id is listed once",
  )

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
  "sessions.templates": {
    default: [
      {
        backend: "claude",
        brief: "assistant.md",
        id: "assistant",
        kind: "assistant",
        label: "Assistant",
      },
      {
        backend: "claude",
        brief: "orchestrator.md",
        id: "orchestrator",
        kind: "orchestrator",
        label: "Orchestrator",
      },
      {
        backend: "claude",
        brief: "dispatcher-2.md",
        id: "second-dispatcher-claude",
        kind: "dispatcher",
        label: "Second dispatcher on Claude",
      },
      {
        backend: "glm",
        brief: "dispatcher-2.md",
        id: "second-dispatcher-glm",
        kind: "dispatcher",
        label: "Second dispatcher on GLM",
      },
    ] as SessionTemplate[],
    description:
      "The templates the sidebar's plus starts a dispatcher or an orchestrator from, A to Z by label: each one's kind, backend, model, effort, account and brief. A dispatcher template starts the second dispatcher; any other kind starts a new <id>-<kind> lead reporting to the dispatcher.",
    schema: sessionTemplates,
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

// The machine's session templates: the defaults until a setting names others; a policy that cannot be read is a refusal.
export const readSessionTemplates = (data: string): SessionTemplate[] => {
  const read = readPolicyOrDefaults(data)
  if (read.refusal !== undefined) throw new Error(read.refusal)
  return sessionSettings.get(read.settings, "sessions.templates")
}
