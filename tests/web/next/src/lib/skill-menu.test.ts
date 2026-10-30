import { describe, expect, test } from "bun:test"

import {
  matchSkills,
  offersSkills,
  pickSkill,
  slashToken,
} from "../../../../../web/next/src/lib/skill-menu"

const at = (text: string) => slashToken(text.replace("|", ""), text.indexOf("|"))

describe("slashToken", () => {
  test("a / at the start, or after a space or a new line, opens on what is typed of a name up to the caret", () => {
    expect(at("/|")).toEqual({ end: 1, query: "", start: 0 })
    expect(at("/da|")).toEqual({ end: 3, query: "da", start: 0 })
    expect(at("hello /da|")).toEqual({ end: 9, query: "da", start: 6 })
    expect(at("hello\n/da| world")).toEqual({ end: 9, query: "da", start: 6 })
  })

  test("a / inside a word, a path, a URL or a name with capitals opens nothing", () => {
    expect(at("a/|")).toBeNull()
    expect(at("https://|")).toBeNull()
    expect(at("/tmp/x|")).toBeNull()
    expect(at("/Da|")).toBeNull()
    expect(at("/da|ily")).toBeNull()
    expect(at("/daily-notes |")).toBeNull()
    expect(at("hello|")).toBeNull()
  })
})

describe("matchSkills", () => {
  const skills = ["daily-notes", "end-of-day", "end-of-week", "notes-sync"]

  test("names holding what is typed, those it starts first, A to Z", () => {
    expect(matchSkills(skills, "")).toEqual(skills)
    expect(matchSkills(skills, "notes")).toEqual(["notes-sync", "daily-notes"])
    expect(matchSkills(skills, "end")).toEqual(["end-of-day", "end-of-week"])
    expect(matchSkills(skills, "zzz")).toEqual([])
  })
})

describe("pickSkill", () => {
  const skills = ["daily-notes", "end-of-day"]
  const pick = (text: string, name = "daily-notes") => {
    const plain = text.replace("|", "")
    const token = slashToken(plain, text.indexOf("|"))
    if (!token) throw new Error(`no token in ${text}`)
    const { caret, text: out } = pickSkill(plain, token, name, skills)
    return `${out.slice(0, caret)}|${out.slice(caret)}`
  }

  test("the skill leads the message, as Claude Code runs a skill only at the start, and the caret stays where it was typed", () => {
    expect(pick("/|")).toBe("/daily-notes |")
    expect(pick("/da| for today")).toBe("/daily-notes |for today")
    expect(pick("text before /da| and after")).toBe("/daily-notes text before |and after")
    expect(pick("two lines\n/da|")).toBe("/daily-notes two lines\n|")
  })

  test("one skill a message: a second pick takes the first one's place", () => {
    expect(pick("/end-of-day notes /da|", "daily-notes")).toBe("/daily-notes notes |")
    expect(pick("/end-of-day /da|")).toBe("/daily-notes |")
    expect(pick("  /end-of-day x /da|")).toBe("/daily-notes x |")
    expect(pick("/da| /end-of-day rest")).toBe("/daily-notes |rest")
  })

  test("a leading / word that is not one of the session's skills is his words, so it stays", () => {
    expect(pick("/tmp/x is full /da|")).toBe("/daily-notes /tmp/x is full |")
    expect(pick("/tmp is full /da|")).toBe("/daily-notes /tmp is full |")
    expect(pick("/clear it /da|")).toBe("/daily-notes /clear it |")
  })
})

describe("offersSkills", () => {
  test("a session in a terminal is offered its skills; a hosted one is not until a hosted send takes a slash command, since its sends refuse every /", () => {
    expect(offersSkills({})).toBe(true)
    expect(offersSkills({ hosted: true })).toBe(false)
  })
})
