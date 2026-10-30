import { DEFAULT_SESSION_NAMES, type SessionNames } from "../packages/config/src/kinds"
import { OLD, OLD_ALIASES } from "./old-names"

// The managers' old names, which a machine past the switch holds as sessions.aliases.
export const OLD_NAMES = OLD_ALIASES

// Such a machine's names: the role words, with the old names as aliases.
export const SEEDED_NAMES: SessionNames = { ...DEFAULT_SESSION_NAMES, aliases: OLD_NAMES }

// A machine whose sessions.names keep the old names, so each kind falls back to its old one.
export const OLD_AS_NAMES: SessionNames = {
  aliases: {},
  names: { builder: OLD.builder, dispatcher: OLD.dispatcher, ops: OLD.ops, planner: OLD.planner },
}
