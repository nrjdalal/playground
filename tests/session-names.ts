import {
  DEFAULT_SESSION_NAMES,
  type NamedKind,
  type SessionNames,
} from "../packages/config/src/kinds"

// Each manager's made-up old name, a stand-in for the names a machine past a rename keeps in sessions.aliases.
export const OLD = {
  builder: "tallowby",
  dispatcher: "corvane",
  ops: "mirrowell",
  planner: "plinthe",
} as const satisfies Record<NamedKind, string>

// The second dispatcher's old name, the first's with -2.
export const OLD_SECOND = `${OLD.dispatcher}-2`

// An old name as a sentence's first word.
export const capital = (name: string) => name[0]!.toUpperCase() + name.slice(1)

// The managers' old names, which a machine past the switch holds as sessions.aliases.
export const OLD_NAMES: Record<string, NamedKind> = {
  ...Object.fromEntries(Object.entries(OLD).map(([role, name]) => [name, role as NamedKind])),
  [OLD_SECOND]: "dispatcher",
}

// Such a machine's names: the role words, with the old names as aliases.
export const SEEDED_NAMES: SessionNames = { ...DEFAULT_SESSION_NAMES, aliases: OLD_NAMES }

// A machine whose sessions.names keep the old names, so each kind falls back to its old one.
export const OLD_AS_NAMES: SessionNames = {
  aliases: {},
  names: { builder: OLD.builder, dispatcher: OLD.dispatcher, ops: OLD.ops, planner: OLD.planner },
}
