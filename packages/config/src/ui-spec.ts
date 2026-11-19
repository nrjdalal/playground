import { z } from "zod"

// A fixed catalog the Inbox card's ```ui block is checked against before it renders: the shapes a ```steps or a ```progress object holds, and the one-line reasons a block that fails to parse gives. packages/config owns them, and web/next draws them.

// The statuses a ```steps block names per step, which ShownState in web/next/src/lib/status-icons.ts draws, so packages/config owns them (one per step, alphabetical).
export const UI_STEP_STATES = z.enum([
  "approval",
  "done",
  "fixing",
  "gated",
  "parked",
  "ready",
  "waiting",
  "working",
])

// The step statuses joined as a sentence, for a refusal that names them.
export const UI_STEP_STATUSES = `${UI_STEP_STATES.options.slice(0, -1).join(", ")} or ${UI_STEP_STATES.options.at(-1)}`

// The reason a block that holds no JSON, or no ui block, gives.
export const UI_REASON_NO_JSON =
  "the ui block holds no JSON, one object with a type of progress or steps"

// A ui block, validated as either a ```progress or a ```steps object, naming the first reason it fails.
export const uiSpecSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("progress"),
    items: z.array(
      z.strictObject({
        eta: z.string().optional(),
        name: z.string(),
        on: z.string(),
        percent: z.number().min(0).max(100),
        state: z.string().optional(),
      }),
    ),
  }),
  z.strictObject({
    type: z.literal("steps"),
    steps: z.array(z.strictObject({ label: z.string(), status: UI_STEP_STATES })),
  }),
])

// A ```steps object or a ```progress object: the step's label and status, the line's name, percent and what's going on with the state or the eta optional, each its own fields alphabetical.
export type UiObject = z.infer<typeof uiSpecSchema>

// A ui block parsed into a progress or a steps object, or a refusal's one-line reason, validated against a fixed catalog before the card renders it.
export type UiParse = { reason: string } | { spec: UiObject }

// A ui block's JSON, the block's content between its fences, or the text as-is when it holds no ```ui block, so a uiSpec gets its JSON whether it is given the fenced block or its content alone.
const extractJson = (text: string): string => {
  const content: string[] = []
  let inside = false
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      if (inside) return content.join("\n")
      inside = true
    } else if (inside) content.push(line)
  }
  return text
}

// A ui block's JSON, parsed into a record, or undefined when it does not parse or is not one object.
const parse = (text: string): unknown => {
  try {
    return JSON.parse(extractJson(text))
  } catch {
    return undefined
  }
}

// A value is one object, not a null or an array.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// The value at a path inside a parsed ui block, walked the way a reason needs it (the bad type, the bad status).
const atPath = (value: unknown, path: readonly (string | number)[]): unknown => {
  let current: unknown = value
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[String(key)]
  }
  return current
}

// The first issue a ui block fails with, turned into the one-line reason the rows expect: the first bad block, its step or line, the prop or field, and why.
const reasonFor = (
  value: Record<string, unknown>,
  issue: { code: string; path: (string | number)[]; keys?: string[] },
): string => {
  const path = issue.path
  const at = atPath(value, path)
  const byLine = (typeof path[1] === "number" ? path[1] + 1 : 1).toString()
  const where = path[0] === "steps" ? "step" : "line"
  if (issue.code === "invalid_union")
    return `the ui block holds an unknown type "${String(at)}", one of progress or steps`
  if (issue.code === "unrecognized_keys")
    return `${where} ${byLine} has an unknown prop "${issue.keys?.[0]}"`
  if (issue.code === "invalid_value")
    return `${where} ${byLine} has an unknown status "${String(at)}", one of ${UI_STEP_STATUSES}`
  if (path[0] === "items" && path[2] === "percent")
    return `${where} ${byLine} has a percent outside 0 to 100`
  return `${where} ${byLine} has a field of the wrong shape`
}

// Pure: a ui block's JSON, parsed and validated, or its one-line reason. The check extracts the JSON from the ```ui block, parses it, and validates it against a progress or a steps object.
export function uiSpec(text: string): UiParse {
  const value = parse(text)
  if (!isRecord(value)) return { reason: UI_REASON_NO_JSON }
  const result = uiSpecSchema.safeParse(value)
  if (result.success) return { spec: result.data }
  return {
    reason: reasonFor(
      value,
      result.error.issues[0]! as {
        code: string
        path: (string | number)[]
        keys?: string[]
      },
    ),
  }
}
