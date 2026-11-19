// A fixed catalog the Inbox card's ```ui block is checked against before it renders, half 1: the shapes a ```steps or a ```progress object holds, the states a steps block names per step, the one-line reasons a block that fails to parse gives, and a block extractor the post-time check runs (PG-2722). packages/config owns these, and web/next draws them, half 2.

// The fence a ui block opens with, to pull one out of an ask's or an update's text, the block the post-time check reads (half 2).
const UI_LANGUAGE = "ui"

// The states a ```steps block names per step, which the card's status icon draws (ShownState in web/next/src/lib/status-icons.ts, half 2), so packages/config owns them, one per step, alphabetical.
export const UI_STEP_STATES = [
  "approval",
  "done",
  "fixing",
  "gated",
  "parked",
  "ready",
  "waiting",
  "working",
] as const

// The status states as a sentence, one of them, for a refusal that names the states.
export const UI_STEP_STATUSES = `${UI_STEP_STATES.slice(0, -1).join(", ")} or ${UI_STEP_STATES.at(-1)}`

// The reason a block that holds no JSON, or no ui block, gives: one object with a type of progress or steps.
export const UI_REASON_NO_JSON =
  "the ui block holds no JSON, one object with a type of progress or steps"

// A ```steps object or a ```progress object: the step's label and status, the line's name, percent and what's going on with the state or the eta optional, each its own fields alphabetical.
export type UiObject =
  | {
      items: { eta?: string; name: string; on: string; percent: number; state?: string }[]
      type: "progress"
    }
  | { steps: { label: string; status: (typeof UI_STEP_STATES)[number] }[]; type: "steps" }

// A ui block parsed into a progress or a steps object, or a refusal's one-line reason, validated against a fixed catalog before the card renders it (PG-2722).
export type UiParse = { reason: string } | { spec: UiObject }

// A ui block, one key plus any value, so the check can name a prop it does not know (PG-2722).
type UiRecord = Record<string, unknown>

// A ui block's JSON, the block's content between its fences, or the text as-is when it holds no ```ui block, so a uiSpec gets its JSON whether it is given the fenced block or its content alone (PG-2722).
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

// The ui blocks in a text, each its content between its fences, in order, the block a ```ui block opens with (PG-2722).
const uiBlocks = (text: string): string[] => {
  const blocks: string[] = []
  let block: string[] | null = null
  let inside = false
  for (const line of text.split("\n")) {
    const fence = line.match(/^\s*```\s*(\S*)/)
    if (fence) {
      if (inside && block) blocks.push(block.join("\n"))
      block = !inside && fence[1] === UI_LANGUAGE ? [] : null
      inside = !inside
    } else if (block) block.push(line)
  }
  return blocks
}

// Why an ask's or an update's text is refused: the first ui block the post-time check reads, one of its reasons, or null when every block parses (PG-2722).
export function uiRefusal(input: unknown): string | null {
  if (!isRecord(input)) return null
  const preview = input.preview
  if (!isRecord(preview) || typeof preview.text !== "string") return null
  if (preview.type !== "ask" && input.kind !== "update") return null
  for (const block of uiBlocks(preview.text)) {
    const result = uiSpec(block)
    if ("reason" in result) return result.reason
  }
  return null
}

// Pure: a ui block's JSON, parsed and validated, or its one-line reason. The check extracts the JSON from the ```ui block, parses it, and validates it against a progress or a steps object (PG-2722).
export function uiSpec(text: string): UiParse {
  const value = parse(text)
  if (!isRecord(value)) return { reason: UI_REASON_NO_JSON }
  return check(value)
}

// A value is one object, not a null or an array (PG-2722).
const isRecord = (value: unknown): value is UiRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// A ui block's JSON, parsed into a record, or undefined when it does not parse or is not one object (PG-2722).
const parse = (text: string): unknown => {
  try {
    return JSON.parse(extractJson(text))
  } catch {
    return undefined
  }
}

// A steps block's status, one of UI_STEP_STATES, which the card's status icon draws (half 2).
const isStepState = (status: string): boolean => UI_STEP_STATES.some((known) => known === status)

// Why a ```steps object is one the card draws: its first step with an unknown prop, named by its line, or an unknown status (half 2).
const validateSteps = (value: UiRecord): UiParse => {
  const steps = value.steps
  if (!Array.isArray(steps)) return { reason: UI_REASON_NO_JSON }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const line = i + 1
    for (const key of Object.keys(step))
      if (key !== "label" && key !== "status")
        return { reason: `step ${line} has an unknown prop "${key}"` }
    const status = String(step.status)
    if (!isStepState(status))
      return {
        reason: `step ${line} has an unknown status "${status}", one of ${UI_STEP_STATUSES}`,
      }
  }
  return { spec: { steps, type: "steps" } as UiObject }
}

// Why a ```progress object is one the card draws: its first line with an unknown prop or a percent outside 0 to 100, named by its line (half 2).
const validateProgress = (value: UiRecord): UiParse => {
  const items = value.items
  if (!Array.isArray(items)) return { reason: UI_REASON_NO_JSON }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const line = i + 1
    for (const key of Object.keys(item))
      if (key !== "name" && key !== "on" && key !== "percent" && key !== "eta" && key !== "state")
        return { reason: `line ${line} has an unknown prop "${key}"` }
    const percent = item.percent
    if (typeof percent !== "number" || percent < 0 || percent > 100)
      return { reason: `line ${line} has a percent outside 0 to 100` }
  }
  return { spec: { items, type: "progress" } as UiObject }
}

// Why a ui block is one the card draws: its type, then the first steps or progress block it names (PG-2722).
const check = (value: UiRecord): UiParse => {
  const type = value.type
  if (type !== "progress" && type !== "steps")
    return {
      reason: `the ui block holds an unknown type "${String(type)}", one of progress or steps`,
    }
  return type === "steps" ? validateSteps(value) : validateProgress(value)
}
