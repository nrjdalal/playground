import { describe, expect, test } from "bun:test"

import {
  ACCESS_ROLE,
  type ActorTarget,
  CONSOLE_ROLES,
  consoleRole,
  findAllowlistRule,
  grantableRoles,
  matchesAllowlist,
  parseAllowlistRule,
  reachesConsole,
  refuseBan,
  refuseRoleChange,
  roleAtLeast,
} from "../../../../packages/auth/src/access"

const at = (
  actorRole: string | null | undefined,
  targetRole: string | null | undefined,
): ActorTarget => ({
  actorRole,
  isSelf: false,
  targetRole,
})

describe("consoleRole", () => {
  test("a known role reads as itself, and anything else as the lowest rung", () => {
    for (const role of CONSOLE_ROLES) expect(consoleRole(role)).toBe(role)
    expect(consoleRole(null)).toBe("user")
    expect(consoleRole(undefined)).toBe("user")
    expect(consoleRole("superuser")).toBe("user")
    expect(consoleRole("constructor")).toBe("user")
  })
})

describe("roleAtLeast", () => {
  test("the ladder is owner, admin, member, user, and an unknown role reads as user", () => {
    expect(roleAtLeast("owner", "user")).toBe(true)
    expect(roleAtLeast("owner", "admin")).toBe(true)
    expect(roleAtLeast("admin", "owner")).toBe(false)
    expect(roleAtLeast("member", "member")).toBe(true)
    expect(roleAtLeast("user", "member")).toBe(false)
    expect(roleAtLeast(null, "user")).toBe(true)
    expect(roleAtLeast("ghost", "member")).toBe(false)
  })
})

describe("reachesConsole", () => {
  test("the rung and the ban together: a banned owner is out, an unknown role is below the rung", () => {
    expect(reachesConsole({ role: "member" })).toBe(true)
    expect(reachesConsole({ role: "user" })).toBe(false)
    expect(reachesConsole({ role: "owner", banned: true })).toBe(false)
    expect(reachesConsole({ role: "member", banned: false })).toBe(true)
    expect(reachesConsole({ role: "user" }, "user")).toBe(true)
  })
})

describe("refuseBan", () => {
  test("each refusal: yourself, an outranked actor, a peer, an owner", () => {
    expect(refuseBan({ ...at("admin", "member"), isSelf: true })).toBe("self")
    expect(refuseBan(at("member", "user"))).toBe("outranked")
    expect(refuseBan(at("admin", "admin"))).toBe("outranked")
    expect(refuseBan(at("admin", "owner"))).toBe("outranked")
  })

  test("an owner may ban any other rung, and another owner", () => {
    expect(refuseBan(at("owner", "admin"))).toBeNull()
    expect(refuseBan(at("owner", "owner"))).toBeNull()
  })
})

describe("grantableRoles", () => {
  test("an admin offering on a member can grant member and user, never a peer or an owner", () => {
    expect(grantableRoles(at("admin", "member"))).toEqual(["member", "user"])
    expect(grantableRoles(at("owner", "member"))).toEqual(["owner", "admin", "member", "user"])
  })
})

describe("refuseRoleChange", () => {
  test("each refusal: an unknown role, yourself, an outranked actor, minting an owner, a peer, the last owner", () => {
    expect(refuseRoleChange({ ...at("owner", "member"), nextRole: "wizard" })).toBe("unknown-role")
    expect(refuseRoleChange({ ...at("owner", "member"), isSelf: true, nextRole: "user" })).toBe(
      "self",
    )
    expect(refuseRoleChange({ ...at("member", "user"), nextRole: "admin" })).toBe("outranked")
    expect(refuseRoleChange({ ...at("admin", "member"), nextRole: "owner" })).toBe("owner-only")
    expect(refuseRoleChange({ ...at("admin", "admin"), nextRole: "user" })).toBe("outranked")
    expect(
      refuseRoleChange({ ...at("owner", "owner"), targetIsLastOwner: true, nextRole: "admin" }),
    ).toBe("last-owner")
  })

  test("an owner may change any other rung below owner, within the last-owner rule", () => {
    expect(refuseRoleChange({ ...at("owner", "member"), nextRole: "admin" })).toBeNull()
    expect(refuseRoleChange({ ...at("owner", "owner"), nextRole: "owner" })).toBeNull()
  })
})

describe("ACCESS_ROLE", () => {
  test("admin is the rung that may change who reaches the console", () => {
    expect(ACCESS_ROLE).toBe("admin")
  })
})

describe("parseAllowlistRule", () => {
  test("a leading @ is a domain rule, anything else an address, both lowercased", () => {
    expect(parseAllowlistRule("@Example.com")).toEqual({ kind: "domain", value: "@example.com" })
    expect(parseAllowlistRule(" User@Example.com ")).toEqual({
      kind: "email",
      value: "user@example.com",
    })
  })

  test("anything that is not one of the two is refused", () => {
    expect(parseAllowlistRule("")).toBeNull()
    expect(parseAllowlistRule("not an address")).toBeNull()
    expect(parseAllowlistRule("@nodot")).toBeNull()
    expect(parseAllowlistRule("a@localhost")).toBeNull()
    expect(parseAllowlistRule("a@b@example.com")).toBeNull()
  })
})

describe("findAllowlistRule", () => {
  const rules = [
    { kind: "domain" as const, value: "@example.com" },
    { kind: "email" as const, value: "specific@example.com" },
  ]

  test("the address rule wins over the domain that also covers the person", () => {
    expect(findAllowlistRule("Specific@Example.com", rules)).toEqual({
      kind: "email",
      value: "specific@example.com",
    })
  })

  test("a domain rule covers its domain exactly, so a subdomain needs its own", () => {
    expect(findAllowlistRule("anyone@example.com", rules)).toEqual({
      kind: "domain",
      value: "@example.com",
    })
    expect(findAllowlistRule("anyone@sub.example.com", rules)).toBeUndefined()
    expect(findAllowlistRule("anyone@example.org", rules)).toBeUndefined()
    expect(findAllowlistRule("anyone@example.com", [])).toBeUndefined()
  })

  test("matchesAllowlist is the same question as a rule being found", () => {
    expect(matchesAllowlist("anyone@example.com", rules)).toBe(true)
    expect(matchesAllowlist("anyone@sub.example.com", rules)).toBe(false)
  })
})
