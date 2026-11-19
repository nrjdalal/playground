// A fixed catalog the Inbox card's ```ui block is checked against before it renders, half 1: the shapes a ```steps or a ```progress object holds, the states a steps block names per step, and the one-line reasons a block that fails to parse gives (PG-2722). The real check parses the block's JSON and validates it, so packages/config owns these and web/next draws them, half 2.

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

// Pure: a ui block's JSON, parsed and validated, or its one-line reason. The real check extracts the JSON from the ```ui block, parses it, and validates it against a progress or a steps object (PG-2722).
export function uiSpec(_text: string): UiParse {
  throw new Error("not built yet")
}

// Pure: why bun run ask refuses an ask's or a read-only update's ui block text, whose card would draw it, the first block that does not read, or null when every block parses (PG-2722).
export function uiRefusal(_input: unknown): string | null {
  throw new Error("not built yet")
}
