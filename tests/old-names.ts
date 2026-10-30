import terms from "../extensions/core/lists/playground-terms.json"
import { LIVE_NAMES, OLD_ROLES } from "../packages/scripts/src/rename/rules"

type Role = (typeof OLD_ROLES)[keyof typeof OLD_ROLES]

// Each role's old session name, read from rename/rules.ts, so a test names an old name only through this loader.
export const OLD = Object.fromEntries(
  Object.entries(OLD_ROLES).map(([name, role]) => [role, name]),
) as Record<Role, keyof typeof OLD_ROLES>

// The second dispatcher's old name, the first's with -2.
export const OLD_SECOND = `${OLD.dispatcher}-2`

// The old names as a machine past the switch holds them in sessions.aliases.
export const OLD_ALIASES: Record<string, Role> = { ...OLD_ROLES, [OLD_SECOND]: "dispatcher" }

export { LIVE_NAMES, OLD_ROLES, terms as TERMS }

// An old name as a sentence's first word.
export const capital = (name: string) => name[0]!.toUpperCase() + name.slice(1)

// The old env names' prefix, which packages/env/src/aliases.ts still reads.
export const OLD_ENV = `${OLD.dispatcher.toUpperCase()}_`
