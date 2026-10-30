import { describe, expect, test } from "bun:test"

import { OLD, OLD_ALIASES, OLD_ROLES, TERMS } from "./old-names"

describe("the old names the tests read", () => {
  test("every old lead name the leak list refuses has a role, and every old name with a role is a term it refuses", () => {
    const refused = new Set([...TERMS.aliases, ...TERMS.names])
    for (const alias of TERMS.aliases) expect(Object.keys(OLD_ROLES)).toContain(alias)
    for (const name of Object.keys(OLD_ROLES)) expect(refused.has(name)).toBe(true)
  })

  test("each role has one old name, and the second dispatcher's alias is the first's with -2", () => {
    expect(Object.keys(OLD).sort()).toEqual(["builder", "dispatcher", "ops", "planner"])
    expect(OLD_ALIASES[`${OLD.dispatcher}-2`]).toBe("dispatcher")
  })
})
