import { describe, expect, spyOn, test } from "bun:test"
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  MAX_ATTACHMENTS,
  withAttachments,
  type Attachment,
} from "../../../../../../api/hono/src/lib/dashboard/attachments"
import {
  CmuxTimedOut,
  holdsKeystroke,
  writeCommand,
  type Write,
} from "../../../../../../api/hono/src/lib/dashboard/cmux"
import {
  deliver,
  holdsMessage,
  inputState,
  keystrokes,
  MAX_CHARS,
  MAX_KEYSTROKES,
  MAX_LINES,
  normalize,
  pieces,
  readSkills,
  refusal,
  SETTLE_GAP_MS,
  SETTLE_READS,
  skillCommand,
  skillDirs,
  type DeliverDeps,
} from "../../../../../../api/hono/src/lib/dashboard/deliver"
import {
  HerdrDown,
  HerdrRefused,
  HerdrTimedOut,
} from "../../../../../../api/hono/src/lib/dashboard/herdr"
import type { Entry } from "../../../../../../api/hono/src/lib/dashboard/transcript"
import type { Live, Worker } from "../../../../../../api/hono/src/lib/dashboard/workers"
import {
  keystrokeCount,
  MESSAGE_MAX_CHARS,
  MESSAGE_MAX_KEYSTROKES,
  MESSAGE_MAX_LINES,
  pastedFile,
} from "../../../../../../web/next/src/lib/paste"
import { LEADING_SKILL } from "../../../../../../web/next/src/lib/skill-menu"
import { NORMALIZE_CASES } from "../../../../../dashboard-normalize-cases"

const SURFACE = "42A9D5E3-E49A-454C-80E6-8884E5ACCC92"

const worker = (over: Partial<Worker> = {}): Worker => ({
  cwd: "/repo",
  effort: null,
  eta: null,
  failed: false,
  feed: [],
  lastActiveAt: null,
  lifecycle: "idle",
  light: "idle",
  model: null,
  name: "dispatcher",
  questions: [],
  role: "dispatcher",
  sessionId: "s-dispatcher",
  startedAt: null,
  task: null,
  tasks: [],
  title: null,
  updatedAt: null,
  workspace: null,
  ...over,
})

const live = (workers: Worker[], surfaces: Record<string, string> = {}): Live => ({
  surfaces: new Map(Object.entries(surfaces)),
  transcripts: new Map(),
  workers,
})

// A Claude Code screen's last lines as read-screen gives them, measured on a probe session: the input box between the rule carrying the session's name and a plain rule, then the status lines.
const RULE = "─".repeat(40)
const screen = (...box: string[]) =>
  [
    "✻ Crystallizing…",
    "",
    `${"─".repeat(30)} dispatcher ─`,
    ...box,
    RULE,
    "  ⚡ $1.1k/d · 📂 dispatcher",
    "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
  ].join("\n")
const EMPTY = screen("❯")
// The same in an 18-column herdr pane, its shape as a live dispatcher pane drew it: a rule as wide as the pane, and status lines cut at its edge.
const narrow = (...box: string[]) =>
  [
    "  ⎿  $ cd ~/some",
    "     /folder",
    "",
    `${"─".repeat(7)} dispatcher ─`,
    ...box,
    "─".repeat(18),
    "  ⚡ $1.1k/d · …",
    "  💡 Opus 5.5 h…",
  ].join("\n")
const NBSP = " "
// A person's message an hour before any paste here, so a transcript read reaches back past each one
const OLDER: Entry = {
  at: "2026-10-06T11:00:00.000Z",
  from: null,
  id: "e0",
  kind: "human",
  text: "earlier",
  tool: null,
}

// A fake terminal and activity table: what was typed where, and what was recorded, in order. The terminal is cmux 0.65's, whose draft guard refuses a send into an input that holds text unless it passes --force (measured by Soren); with `guard` false it is 0.64's, which has no guard and types a --force as text (measured on probe-multiline).
function fakes(board: Live, failOn?: (step: Write, index: number) => boolean, guard = true) {
  const typed: Write[] = []
  const recorded: string[] = []
  const rows = new Map<string, Date>()
  const skillsRead: string[] = []
  let input = ""
  const deps: DeliverDeps = {
    board: async () => board,
    canForce: async () => guard,
    delivered: async (id) => rows.get(id) ?? null,
    now: () => new Date("2026-10-06T12:00:00.000Z"),
    pressEnter: async () => {},
    prompt: async () => {},
    prompts: async () => [],
    readScreen: async () => EMPTY,
    readSession: async () => board,
    record: async (event, typing) => {
      recorded.push(event.summary)
      await typing()
      if (event.id) rows.set(event.id, deps.now())
    },
    said: async () => [OLDER],
    skills: async (cwd) => {
      skillsRead.push(cwd)
      return new Set(["end-of-day", "acme"])
    },
    wait: async () => {},
    write: async (step) => {
      if (failOn?.(step, typed.length)) throw new Error("no such surface")
      if ("text" in step) {
        if (step.force && !guard) throw new Error("this cmux types --force as text")
        if (guard && input && !step.force) {
          throw new Error(
            "send: the agent prompt holds text someone is typing, so nothing was sent.",
          )
        }
        input += step.text
      } else input = step.key === "enter" ? "" : `${input}\n`
      typed.push(step)
    },
  }
  return { deps, recorded, skillsRead, typed }
}

const actor = { email: "owner@local.host", id: "u-1" }
const board = () => live([worker()], { "s-dispatcher": SURFACE })

describe("normalize", () => {
  test("line ends become \\n, tabs four spaces, every control character goes (C0, DEL, C1), and the ends are trimmed", () => {
    for (const [input, typed] of NORMALIZE_CASES) expect(normalize(input)).toBe(typed)
  })
})

describe("refusal", () => {
  test("text the dashboard will not type", () => {
    expect(refusal("")).toMatchObject({ code: "EMPTY", ok: false })
    expect(refusal("x".repeat(MAX_CHARS + 1))).toMatchObject({ code: "TOO_LONG" })
    expect(
      refusal(
        Array(MAX_LINES + 1)
          .fill("x")
          .join("\n"),
      ),
    ).toMatchObject({ code: "TOO_LONG" })
    expect(refusal("/clear")).toMatchObject({ code: "COMMAND" })
    expect(refusal("!rm -rf build")).toMatchObject({ code: "COMMAND" })
  })

  test("the composer's paste rule holds the same caps, so a long paste goes as a file and his words alone are judged", () => {
    expect([MESSAGE_MAX_CHARS, MESSAGE_MAX_LINES]).toEqual([MAX_CHARS, MAX_LINES])
    const pasted = "Made-up meeting notes. ".repeat(700)
    expect(refusal(normalize(`Summarise this:\n${pasted}`))).toMatchObject({ code: "TOO_LONG" })
    expect(pastedFile(pasted, "Summarise this:\n")).not.toBeNull()
    expect(refusal(normalize("Summarise this:\n"), 1)).toBeNull()
    expect(refusal("", 1)).toBeNull()
  })

  test("the paste rule counts keystrokes as deliver() types them, and keeps room for a reply's tag and five files", () => {
    expect(MESSAGE_MAX_KEYSTROKES).toBe(MAX_KEYSTROKES)
    for (const text of ["", "a", "a\nb", "a\\n\\t\\rb\n\\", "\\\\n", "x\n\ny"]) {
      expect(keystrokeCount(text)).toBe(keystrokes(text).length)
    }
    // a short log line dense with escaped new lines
    const log = `{"log":"${"a\\n".repeat(450)}"}`
    expect(log.length).toBeLessThan(2000)
    expect(pastedFile(log, "")).not.toBeNull()
    const files = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => ({
      path: `/Users/someone/.playground/attachments/0000000${i}-0000-4000-8000-000000000000.txt`,
    }))
    // what deliver() would be asked to type: the words tagged with a picked reply, as withReply puts it, and five files
    const fits = (pasted: string, before: string, after: string) => {
      const sent = normalize(`re #i99999: ${before}${pasted}${after}`)
      return (
        !refusal(sent, MAX_ATTACHMENTS) &&
        keystrokes(withAttachments(sent, files)).length <= MAX_KEYSTROKES
      )
    }
    const typed = "Made-up meeting notes. ".repeat(400).slice(0, 7000)
    for (const [pasted, words, asFile, after = ""] of [
      ["x".repeat(995), typed, true],
      ["x".repeat(1000), typed.slice(0, 6984), false],
      ["x".repeat(1000), typed.slice(0, 6985), true],
      // at the keystroke cap from both sides: one line, then a piece per escape
      [`x${"a\\n".repeat(386)}`, "", false],
      [`x${"a\\n".repeat(387)}`, "", true],
      // an empty first line, where the reply's tag costs a keystroke of its own
      [`\n${"a\\n".repeat(385)}`, "", false],
      [`\n${"a\\n".repeat(386)}`, "", true],
      // a control character between the backslash and the n is dropped before deliver() counts
      ["\\\u0001n".repeat(450), "", true],
      // lone carriage returns are line ends
      [Array(MAX_LINES).fill("z").join("\r"), "", false],
      [
        Array(MAX_LINES + 1)
          .fill("z")
          .join("\r"),
        "",
        true,
      ],
      // a paste ending in \r beside a box line starting with \n is two line ends
      [
        `${Array(MAX_LINES - 1)
          .fill("z")
          .join("\n")}\r`,
        "",
        true,
        "\nz",
      ],
      // pasted mid-box: its closing backslash meets the n after the cursor and makes a piece of its own
      [`${"a\\n".repeat(385)}\\`, "x", false, "n"],
      [`${"a\\n".repeat(386)}\\`, "x", true, "n"],
    ] as const) {
      expect(pastedFile(pasted, words, after) !== null).toBe(asFile)
      if (!asFile) expect(fits(pasted, words, after)).toBe(true)
    }
  })

  test("a command behind invisible characters is still a command", () => {
    for (const text of ["\u200B/exit", "\u2060!rm -rf x", "\uFEFF\u200B /clear", "\u00A0!ls"]) {
      expect(refusal(normalize(text))).toMatchObject({ code: "COMMAND" })
    }
    expect(refusal(normalize("\u0085/exit"))).toMatchObject({ code: "COMMAND" })
  })

  test("everything else goes, a leading # or @ and a / mid-text included", () => {
    for (const text of ["# heading", "@greed look", "run /acme CEDAR-1 next", "a\n/b"]) {
      expect(refusal(text)).toBeNull()
    }
  })
})

describe("readSkills", () => {
  const skill = async (dir: string, name: string, front: string | null) => {
    await mkdir(join(dir, name), { recursive: true })
    const text = front === null ? "no frontmatter" : `---\n${front}\n---\nBody\n`
    await writeFile(join(dir, name, "SKILL.md"), text)
  }

  test("every skill folder whose SKILL.md a person may invoke, across the folders given", async () => {
    const root = await mkdtemp(join(tmpdir(), "skills-"))
    const user = join(root, "user")
    const project = join(root, "project")
    const elsewhere = join(root, "checkout")
    await skill(user, "end-of-day", "name: end-of-day\ndescription: lines")
    await skill(user, "linear-scan", "name: linear-scan\nuser-invocable: false")
    await skill(user, "broken", "name: [unclosed")
    await skill(user, "bare", null)
    await skill(user, "dotted.name", "name: dotted")
    await skill(user, "Upper", "name: Upper")
    await skill(elsewhere, "linked", "name: linked")
    await symlink(join(elsewhere, "linked"), join(user, "linked"))
    await mkdir(join(user, "folder-not-file", "SKILL.md"), { recursive: true })
    await skill(project, "codebase-map", "name: codebase-map\nuser-invocable: true")
    expect([...(await readSkills([user, project, join(root, "missing")]))].sort()).toEqual([
      "codebase-map",
      "end-of-day",
      "linked",
    ])
  })
})

describe("the composer's copy of a skill's command", () => {
  test("reads the same leading skill as skillCommand, so the / menu and the send check agree", () => {
    for (const text of [
      "/a",
      "/a b",
      "/a\nb",
      "/a/b",
      "/A",
      "/-a",
      "/a-b c",
      " /a",
      "/a\tb",
      "a /b",
    ]) {
      expect(LEADING_SKILL.exec(text)?.[0].trimEnd().slice(1) ?? null).toBe(skillCommand(text))
    }
  })
})

describe("skillDirs", () => {
  test("the config folder's skills, and the project's only for a session whose cwd is known", () => {
    expect(skillDirs("/work/app", "/home/.claude", true)).toEqual([
      "/home/.claude/skills",
      "/work/app/.claude/skills",
    ])
    for (const cwd of ["", "relative/app"]) {
      expect(skillDirs(cwd, "/home/.claude", true)).toEqual(["/home/.claude/skills"])
    }
  })

  test("a stack that does not read this machine never reads a session's cwd, which a fixture made up", () => {
    expect(skillDirs("/work/app", "/fixture/claude", false)).toEqual(["/fixture/claude/skills"])
  })
})

describe("pieces", () => {
  test("a line is cut after every backslash that precedes n, r or t, and nowhere else", () => {
    expect(pieces("C:\\temp\\new")).toEqual(["C:\\", "temp\\", "new"])
    expect(pieces("a\\\\nb")).toEqual(["a\\\\", "nb"])
    expect(pieces("keep \\N \\e \\x41 \\u0041 and a trailing \\")).toEqual([
      "keep \\N \\e \\x41 \\u0041 and a trailing \\",
    ])
    expect(pieces("plain")).toEqual(["plain"])
    expect(pieces("")).toEqual([])
  })
})

describe("keystrokes", () => {
  test("one line is its text, then Enter", () => {
    expect(keystrokes("hello")).toEqual([{ text: "hello" }, { key: "enter" }])
  })

  test("lines are joined by Shift+Enter, a blank line included, and only the end submits", () => {
    expect(keystrokes("one\n\nthree")).toEqual([
      { text: "one" },
      { key: "shift+enter" },
      { key: "shift+enter" },
      { text: "three" },
      { key: "enter" },
    ])
  })

  test("every piece is safe for cmux send, and the pieces put back together are the message", () => {
    const samples = [
      "C:\\temp\\new\\red\\tab",
      "\\n\\r\\t at the start",
      "ends with \\",
      "double \\\\n and \\\\\\t",
      "unicode café → ✓ 🙂 and `code` with $HOME",
      "line one\nline \\two\n\n  indented \\n line",
      "a C1 \u0085 control and \u009b",
    ]
    for (const sample of samples) {
      const text = normalize(sample)
      const steps = keystrokes(text)
      const rebuilt = steps
        .map((step) => ("text" in step ? step.text : step.key === "shift+enter" ? "\n" : ""))
        .join("")
      expect(rebuilt).toBe(text)
      for (const step of steps) {
        if ("text" in step) expect(holdsKeystroke(step.text)).toBe(false)
        expect(() => writeCommand({ ...step, surface: SURFACE })).not.toThrow()
      }
    }
  })
})

describe("holdsMessage", () => {
  test("the box starts as the message does, cut at the screen's edge, or as the fold of a paste or an image", () => {
    const text = "Is send on the right? why\n\nAttached: /x/a.png"
    expect(holdsMessage(screen("❯ Is send on the right? why"), text)).toBe(true)
    expect(holdsMessage(screen("❯ Is send on the ri"), text)).toBe(true)
    expect(holdsMessage(screen("❯ [Pasted text #1 +3 lines]"), text)).toBe(true)
    expect(holdsMessage(screen("❯ [Image #1] Is send"), text)).toBe(true)
    expect(holdsMessage(screen("❯ something else"), text)).toBe(false)
    expect(holdsMessage(EMPTY, text)).toBe(false)
    expect(holdsMessage("no box at all", text)).toBe(false)
  })

  test("a fold wrapped onto a second line in a narrow pane still reads as the paste", () => {
    expect(holdsMessage(narrow("❯ [Pasted text", "  #1 +12 lines]"), "a\nb\nc")).toBe(true)
    expect(holdsMessage(narrow("❯ [Image #1][Pas", "  ted text #2]"), "a")).toBe(true)
  })
})

describe("inputState", () => {
  test("an input holding only its prompt is empty, busy or not", () => {
    expect(inputState(EMPTY)).toBe("empty")
    expect(inputState(`${EMPTY}\n\n`)).toBe("empty")
  })

  // A busy session shows this hint while a message waits in its queue: a second message joins the queue rather than waiting for the turn to end.
  test("an input showing only the queued-messages hint is empty", () => {
    expect(inputState(screen("❯\u00a0Press up to edit queued messages"))).toBe("empty")
    expect(inputState(screen("❯\u00a0Press up to edit queued"))).toBe("holds")
    expect(inputState(screen("❯\u00a0Press up to edit queued messages", "  more"))).toBe("holds")
  })

  // a busy probe's own screen (Claude Code 2.1.309 in herdr) with two dashboard messages and a peer message in its queue, which it draws above the box, never in it.
  const PROBE_QUEUED = [
    "  ⎿  $ sleep 540 (1m 58s)",
    "     (ctrl+b to run in background)",
    "❯ first queued probe message",
    "❯ second queued probe message",
    "› Message from @worker: third message, sent as a peer message while",
    "you sleep: answer ok after your sleep. (ctrl+o to expand)",
    "  ctrl+enter to send now",
    "✢ Meandering… (2m 4s · ↓ 328 tokens)",
    `  ⎿${NBSP}Tip: Use /btw to ask a quick side question without interrupting`,
    "     Claude's current work",
    `${"─".repeat(60)} probe-queue ─`,
    `❯${NBSP}Press up to edit queued messages`,
    "─".repeat(74),
    "  ⚡ $1.7k/d · 📂 dispatcher · 🌱 main · 💾 5%",
    "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
  ].join("\n")

  test("a busy session with messages in its queue reads empty, as the probe's screen shows it", () => {
    expect(inputState(PROBE_QUEUED)).toBe("empty")
  })

  // Claude Code's queue hints (its prompt input's placeholder while messages wait), each drawn alone in an empty box, wrapped onto a second line in a narrow pane, and read with a no-break space or a plain one after the ❯.
  test("every queue hint Claude Code draws reads empty, wrapped or not, after either space", () => {
    for (const hint of [
      "Press up to edit queued messages",
      "Press up to edit queued messages, Enter to send them immediately",
      "Press up to select a queued message to edit, or Enter to send them now",
      "Press up to select a queued message, then Enter to edit it",
    ]) {
      expect(inputState(screen(`❯${NBSP}${hint}`))).toBe("empty")
      expect(inputState(screen(`❯ ${hint}`))).toBe("empty")
    }
    expect(
      inputState(screen("❯ Press up to edit queued messages, Enter to send", "  them immediately")),
    ).toBe("empty")
  })

  // a pane narrower than the hint cuts it off with an ellipsis, as the 18-column dispatcher pane drew it after every send to it while busy
  test("a queue hint cut off at a narrow pane's edge reads empty", () => {
    expect(inputState(narrow("❯ Press up to edi…"))).toBe("empty")
    expect(inputState(narrow(`❯${NBSP}Press up to select a…`))).toBe("empty")
    expect(inputState(narrow("❯ Press up to see…"))).toBe("holds")
    expect(inputState(narrow("❯ Press up to edi…", "  more"))).toBe("holds")
    expect(inputState(narrow("❯ …"))).toBe("holds")
  })

  test("a hand-typed draft holds, even one that starts as a queue hint does", () => {
    expect(inputState(screen("❯ Press up to see more"))).toBe("holds")
    expect(inputState(screen("❯ Press up to edit queued messages please"))).toBe("holds")
    expect(inputState(screen("❯ Press up to edit queued messages", "  and then stop"))).toBe(
      "holds",
    )
    // the owner pressed up in the terminal and is editing a queued message
    expect(
      inputState(screen("❯ Press Enter to edit the selected message, or up again for history")),
    ).toBe("holds")
  })

  // A prompt suggestion is the dim text Claude Code fills an empty box with after a turn: read-screen drops the dimming, so it reads like a draft and the dashboard refuses the send rather than typing over it. Factory sessions start with suggestions off (scripts/factory-settings.json), so this is the shape a session with them on still shows.
  test("an input holding only a prompt suggestion holds something", () => {
    expect(inputState(screen('❯ Try "run the suite"'))).toBe("holds")
    expect(inputState(screen('❯\u00a0Try "run the suite"'))).toBe("holds")
  })

  test("a draft, shell mode, an open / menu or two lines of input hold something", () => {
    expect(inputState(screen("❯\u00a0a draft left here"))).toBe("holds")
    expect(inputState(screen("!"))).toBe("holds")
    expect(inputState(screen("❯\u00a0/"))).toBe("holds")
    expect(inputState(screen("❯\u00a0line one", "  line two"))).toBe("holds")
  })

  test("a picker between rules holds something, and a screen with no rules has no input box", () => {
    const picker = [
      RULE,
      " ☐ Color",
      "Pick a color?",
      "❯ 1. Red",
      "  2. Blue",
      RULE,
      "Enter to select · ↑/↓ to navigate · Esc to cancel",
    ].join("\n")
    expect(inputState(picker)).toBe("holds")
    expect(inputState("")).toBe("missing")
    expect(inputState("❯")).toBe("missing")
    expect(inputState(`${RULE}\n❯`)).toBe("missing")
  })
})

describe("deliver", () => {
  test("types the message into the named session's own surface and records its size, not its words", async () => {
    const { deps, recorded, typed } = fakes(board())
    const result = await deliver(
      { actor, text: "check the queue\nthen stop", to: "dispatcher" },
      deps,
    )
    expect(result).toEqual({ at: "2026-10-06T12:00:00.000Z", ok: true, sessionId: "s-dispatcher" })
    expect(typed).toEqual([
      { force: true, surface: SURFACE, text: "check the queue" },
      { key: "shift+enter", surface: SURFACE },
      { force: true, surface: SURFACE, text: "then stop" },
      { key: "enter", surface: SURFACE },
    ])
    expect(recorded).toEqual(["Sent dispatcher a message of 25 characters on 2 lines"])
    expect(recorded[0]).not.toContain("queue")
  })

  test("a busy session takes the message: it queues as typed input does", async () => {
    const { deps, typed } = fakes(
      live([worker({ lifecycle: "running", light: "working" })], { "s-dispatcher": SURFACE }),
    )
    expect((await deliver({ actor, text: "next", to: "dispatcher" }, deps)).ok).toBe(true)
    expect(typed).toHaveLength(2)
  })

  test("two live sessions named for the dispatcher: the oldest keeps the role and takes the send, with no 409", async () => {
    const { deps, typed } = fakes(
      live(
        [
          // the read's own rule has already demoted the newer one to other (workers.ts)
          worker({ role: "other", sessionId: "s-new", startedAt: "2026-10-06T13:00:00.000Z" }),
          worker({ startedAt: "2026-10-06T09:00:00.000Z" }),
        ],
        { "s-dispatcher": SURFACE, "s-new": "SURF-2" },
      ),
    )
    expect((await deliver({ actor, text: "hi", to: "dispatcher" }, deps)).ok).toBe(true)
    expect(typed).toHaveLength(2)
    expect(typed.every((t) => t.surface === SURFACE)).toBe(true)
  })

  // #i520: the second dispatcher is a target as the primary is, its name reaching the session that holds its role
  test("the second dispatcher takes the send into its own surface, and of two by its name the one holding the role does", async () => {
    const { deps, typed } = fakes(
      live(
        [
          worker(),
          worker({ name: "dispatcher-2", role: "other", sessionId: "s-glm-new" }),
          worker({ name: "dispatcher-2", sessionId: "s-glm" }),
        ],
        { "s-glm": "SURF-GLM", "s-glm-new": "SURF-2", "s-dispatcher": SURFACE },
      ),
    )
    expect(await deliver({ actor, text: "hi", to: "dispatcher-2" }, deps)).toMatchObject({
      ok: true,
      sessionId: "s-glm",
    })
    expect(typed.length).toBeGreaterThan(0)
    expect(typed.every((t) => t.surface === "SURF-GLM")).toBe(true)
  })

  test("two live sessions sharing another name still refuse as ambiguous", async () => {
    const { deps, typed } = fakes(
      live(
        [
          worker({ name: "worker-x", role: "worker" }),
          worker({ name: "worker-x", role: "worker", sessionId: "s-two" }),
        ],
        { "s-dispatcher": SURFACE },
      ),
    )
    expect(await deliver({ actor, text: "hi", to: "worker-x" }, deps)).toMatchObject({
      code: "AMBIGUOUS",
      ok: false,
    })
    expect(typed).toEqual([])
  })

  test("refuses, typing nothing and recording nothing, when it cannot tell the right session or it is on a picker", async () => {
    const cases: [Live, string][] = [
      [live([], {}), "NOT_FOUND"],
      [
        live([worker({ light: "needs-you", lifecycle: "needsInput" })], {
          "s-dispatcher": SURFACE,
        }),
        "ON_PICKER",
      ],
      [live([worker()], {}), "NOT_FOUND"],
    ]
    for (const [state, code] of cases) {
      const { deps, recorded, typed } = fakes(state)
      expect(await deliver({ actor, text: "hi", to: "dispatcher" }, deps)).toMatchObject({
        code,
        ok: false,
      })
      expect(typed).toEqual([])
      expect(recorded).toEqual([])
    }
  })

  test("refuses to type into an input that already holds something, which the message would join", async () => {
    for (const box of ["❯\u00a0a draft", "!", "❯\u00a0/"]) {
      const { deps, recorded, typed } = fakes(board())
      deps.readScreen = async () => screen(box)
      expect(await deliver({ actor, text: "hi", to: "dispatcher" }, deps)).toMatchObject({
        code: "INPUT_NOT_EMPTY",
        ok: false,
      })
      expect(typed).toEqual([])
      expect(recorded).toEqual([])
    }
  })

  test("a screen with no input box is refused with its own reason, so a changed layout shows", async () => {
    const { deps, typed } = fakes(board())
    deps.readScreen = async () => "a dialog with no rules"
    const result = await deliver({ actor, text: "hi", to: "dispatcher" }, deps)
    expect(result).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
    expect(result.ok ? "" : result.reason).toContain("Cannot find dispatcher's input box")
    expect(typed).toEqual([])
  })

  test("refuses text it will not type before it reads cmux", async () => {
    const { deps, typed } = fakes(board())
    deps.board = async () => {
      throw new Error("must not be read")
    }
    deps.readSession = deps.board
    for (const [text, code] of [
      ["   ", "EMPTY"],
      ["!ls", "COMMAND"],
      ["\u200B/end-of-day", "COMMAND"],
      [Array(MAX_KEYSTROKES).fill("\\n").join(""), "TOO_LONG"],
    ]) {
      expect(await deliver({ actor, text: text!, to: "dispatcher" }, deps)).toMatchObject({ code })
    }
    expect(typed).toEqual([])
  })

  test("a / and the name of a skill the session can run is typed, as Merritt would type it", async () => {
    const { deps, skillsRead, typed } = fakes(
      live([worker({ cwd: "/work/dispatcher" })], { "s-dispatcher": SURFACE }),
    )
    expect(
      await deliver({ actor, text: "/end-of-day for me", to: "dispatcher" }, deps),
    ).toMatchObject({
      ok: true,
    })
    expect(skillsRead).toEqual(["/work/dispatcher"])
    expect(typed).toEqual([
      { force: true, surface: SURFACE, text: "/end-of-day for me" },
      { key: "enter", surface: SURFACE },
    ])
  })

  test("any other / is refused once the session's skills are read: a built-in, an unknown name, a lookalike", async () => {
    for (const text of [
      "/clear",
      "/exit",
      "/model opus",
      "/nope",
      "/End-of-day",
      "/light\u200Bday",
      "/end-of-day\u200B now",
      "/end-of-day/../x",
      "/end-of-day.md",
      "/end-of-day:x",
    ]) {
      const { deps, recorded, typed } = fakes(board())
      expect(await deliver({ actor, text, to: "dispatcher" }, deps)).toMatchObject({
        code: "COMMAND",
        ok: false,
      })
      expect(typed).toEqual([])
      expect(recorded).toEqual([])
    }
  })

  test("a ! is a shell command, refused even when a skill bears the name", async () => {
    const { deps, typed } = fakes(board())
    expect(await deliver({ actor, text: "!end-of-day", to: "dispatcher" }, deps)).toMatchObject({
      code: "COMMAND",
    })
    expect(typed).toEqual([])
  })

  test("a cmux that cannot be read is CMUX_FAILED, with cmux's own words", async () => {
    const { deps } = fakes(live([]))
    deps.board = async () => {
      throw new Error("Access denied")
    }
    const result = await deliver({ actor, text: "hi", to: "dispatcher" }, deps)
    expect(result).toMatchObject({ code: "CMUX_FAILED" })
    expect(result.ok ? "" : result.reason).toBe("Could not read cmux: Access denied")
  })

  // A keystroke cmux refuses after typing began is INTERRUPTED, saying what may be left in the input: cmux ends a write that runs past its timeout, so even the Enter reported failed may have landed.
  test("a keystroke cmux refuses once typing began is INTERRUPTED, saying what may be left in the input", async () => {
    const middle = fakes(board(), (_, i) => i === 2)
    const part = await deliver({ actor, text: "a\nb", to: "dispatcher" }, middle.deps)
    expect(part.ok ? "" : part.reason).toContain("Part of it may sit unsent in dispatcher's input.")
    const enter = fakes(board(), (step) => "key" in step && step.key === "enter")
    const atEnter = await deliver({ actor, text: "a\nb", to: "dispatcher" }, enter.deps)
    expect(atEnter.ok ? "" : atEnter.reason).toContain("The Enter may have gone through anyway")
  })

  test("a record that cannot be inserted throws, and nothing is typed", async () => {
    const { deps, typed } = fakes(board())
    deps.record = async () => {
      throw new Error("database down")
    }
    await expect(deliver({ actor, text: "hi", to: "dispatcher" }, deps)).rejects.toThrow(
      "database down",
    )
    expect(typed).toEqual([])
  })

  test("a commit that fails after the Enter throws although the message went: the contract says so", async () => {
    const { deps, typed } = fakes(board())
    deps.record = async (_, typing) => {
      await typing()
      throw new Error("commit failed")
    }
    await expect(deliver({ actor, text: "hi", to: "dispatcher" }, deps)).rejects.toThrow(
      "commit failed",
    )
    expect(typed.map((step) => ("text" in step ? step.text : step.key))).toEqual(["hi", "enter"])
  })

  test("a picker raised while typing stops it before the Enter, which would answer the picker", async () => {
    const { deps, recorded, typed } = fakes(board())
    // The session is read once when its turn comes, and once more before the Enter.
    let reads = 0
    deps.readSession = async () => {
      reads += 1
      return reads < 2
        ? board()
        : live([worker({ light: "needs-you" })], { "s-dispatcher": SURFACE })
    }
    const result = await deliver({ actor, text: "a\nb", to: "dispatcher" }, deps)
    expect(result).toMatchObject({ code: "INTERRUPTED", ok: false })
    expect(result.ok ? "" : result.reason).toContain("typed but not sent")
    expect(typed.map((step) => ("text" in step ? step.text : step.key))).toEqual([
      "a",
      "shift+enter",
      "b",
    ])
    expect(recorded).toHaveLength(1)
  })

  // a 30-line paste reached the session whole yet read as failed, since cmux 0.65 refused the second line's send into an input holding the first.
  test("a long message goes whole past cmux's draft guard: every send, the first included, passes --force", async () => {
    const { deps, typed } = fakes(board())
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1} of a pasted thread`)
    const result = await deliver({ actor, text: lines.join("\n"), to: "dispatcher" }, deps)
    expect(result.ok).toBe(true)
    const sends = typed.filter((step) => "text" in step)
    expect(sends.map((step) => step.text)).toEqual(lines)
    expect(sends.map((step) => "force" in step && step.force === true)).toEqual(
      lines.map(() => true),
    )
  })

  test("a single line cut at a backslash before n, r or t goes whole past the guard", async () => {
    const { deps, typed } = fakes(board())
    expect((await deliver({ actor, text: "open C:\\new\\tmp", to: "dispatcher" }, deps)).ok).toBe(
      true,
    )
    expect(typed).toEqual([
      { force: true, surface: SURFACE, text: "open C:\\" },
      { force: true, surface: SURFACE, text: "new\\" },
      { force: true, surface: SURFACE, text: "tmp" },
      { key: "enter", surface: SURFACE },
    ])
  })

  // cmux 0.64 has no draft guard and no --force: it types the flag into the input as text (measured on probe-multiline).
  test("a cmux with no --force gets none, and the message still goes whole", async () => {
    const { deps, typed } = fakes(board(), undefined, false)
    expect((await deliver({ actor, text: "a\nb\nc", to: "dispatcher" }, deps)).ok).toBe(true)
    expect(typed.some((step) => "force" in step)).toBe(false)
    expect(typed.map((step) => ("text" in step ? step.text : step.key))).toEqual([
      "a",
      "shift+enter",
      "b",
      "shift+enter",
      "c",
      "enter",
    ])
  })

  test("a cmux whose --force cannot be told is CMUX_FAILED, and nothing is typed", async () => {
    const { deps, recorded, typed } = fakes(board())
    deps.canForce = async () => {
      throw new Error("no answer from cmux")
    }
    const result = await deliver({ actor, text: "a\nb", to: "dispatcher" }, deps)
    expect(result).toMatchObject({ code: "CMUX_FAILED", ok: false })
    expect(typed).toEqual([])
    expect(recorded).toEqual([])
  })

  // --force skips cmux's dialog check too, so a prompt the session raises mid-message stops the typing before the next forced line would land in it.
  test("a prompt raised while typing stops it before the next line, which --force would type into the prompt", async () => {
    const { deps, typed } = fakes(board())
    let reads = 0
    // Read once for the baseline, once before the first send, once before the second.
    deps.prompts = async () => (++reads > 2 ? ["old", "new"] : ["old"])
    const result = await deliver({ actor, text: "a\nb\nc", to: "dispatcher" }, deps)
    expect(result).toMatchObject({ code: "INTERRUPTED", ok: false })
    expect(result.ok ? "" : result.reason).toContain(
      "Part of it sits unsent in dispatcher's input.",
    )
    expect(typed.map((step) => ("text" in step ? step.text : step.key))).toEqual([
      "a",
      "shift+enter",
    ])
  })

  // A send once failed with "holds text someone is typing, so nothing was sent" on an empty input: Claude Code's queued-messages hint and a mid-turn prompt line read as an empty input by design, yet cmux 0.65's draft guard sees text there and refuses a send without --force.
  const DRAFT_GUARD =
    "send: the agent prompt in 77BD77D9 holds text someone is typing, so nothing was sent. Retry when the prompt is clear, or pass --force to send anyway."

  // deliver logs every failed try; a test that expects one listens, the rest stay quiet.
  const logged = async (run: (warn: ReturnType<typeof spyOn>) => Promise<void>) => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      await run(warn)
    } finally {
      warn.mockRestore()
    }
  }

  test("the first send takes --force too, so a guard that sees a queued hint cannot refuse a message of one line", async () => {
    const { deps, typed } = fakes(board())
    const write = deps.write
    deps.write = async (step) => {
      if ("text" in step && !step.force) throw new Error(DRAFT_GUARD)
      await write(step)
    }
    expect((await deliver({ actor, text: "hello", to: "dispatcher" }, deps)).ok).toBe(true)
    expect(typed).toEqual([
      { force: true, surface: SURFACE, text: "hello" },
      { key: "enter", surface: SURFACE },
    ])
  })

  // The Feed is read first of all and kept, so a prompt raised in the gap before the screen read or between the tries is one the typing stops for.
  test("a message of one send reads whether cmux takes --force and the Feed before the session's screen, and the Feed again at the send", async () => {
    const { deps } = fakes(board())
    const reads: string[] = []
    const canForce = deps.canForce
    const readScreen = deps.readScreen
    deps.canForce = async () => {
      reads.push("help")
      return canForce()
    }
    deps.prompts = async () => {
      reads.push("feed")
      return []
    }
    deps.readScreen = async (surface) => {
      reads.push("screen")
      return readScreen(surface)
    }
    expect((await deliver({ actor, text: "one line", to: "dispatcher" }, deps)).ok).toBe(true)
    expect(reads).toEqual(["help", "feed", "screen", "feed"])
  })

  // --force skips the guard's dialog check, so a prompt raised after the Feed was read must stop even the first send.
  test("a prompt raised before the first send refuses it as ON_PICKER, with nothing typed", async () => {
    const { deps, typed } = fakes(board())
    let reads = 0
    deps.prompts = async () => (++reads > 1 ? ["raised"] : [])
    const result = await deliver({ actor, text: "a\nb", to: "dispatcher" }, deps)
    expect(result).toMatchObject({ code: "ON_PICKER", ok: false })
    expect(result.ok ? "" : result.reason).toContain("Nothing was typed.")
    expect(typed).toEqual([])
  })

  test("a prompt raised during the screen read stops the send, which --force would have typed into it", async () => {
    const { deps, typed } = fakes(board())
    let raised = false
    deps.prompts = async () => (raised ? ["raised"] : [])
    const readScreen = deps.readScreen
    deps.readScreen = async (surface) => {
      raised = true
      return readScreen(surface)
    }
    expect(await deliver({ actor, text: "hello", to: "dispatcher" }, deps)).toMatchObject({
      code: "ON_PICKER",
      ok: false,
    })
    expect(typed).toEqual([])
  })

  // cmux 0.64 has no --force and no dialog check to skip, but a later line of a message still lands in a prompt raised meanwhile.
  test("on a cmux with no --force, a prompt raised while typing still stops the rest, and a message of one send reads no Feed", async () => {
    const stops = fakes(board(), undefined, false)
    let reads = 0
    stops.deps.prompts = async () => (++reads > 1 ? ["new"] : [])
    const result = await deliver({ actor, text: "a\nb\nc", to: "dispatcher" }, stops.deps)
    expect(result).toMatchObject({ code: "INTERRUPTED", ok: false })
    expect(stops.typed.some((step) => "force" in step)).toBe(false)
    const one = fakes(board(), undefined, false)
    let feed = 0
    one.deps.prompts = async () => {
      feed += 1
      return []
    }
    expect((await deliver({ actor, text: "one line", to: "dispatcher" }, one.deps)).ok).toBe(true)
    expect(feed).toBe(0)
  })

  test("a send cmux refuses before anything is typed is tried once more at once, and goes when that passes", async () => {
    const { deps, typed } = fakes(board())
    const write = deps.write
    let refusals = 0
    deps.write = async (step) => {
      if (refusals++ < 1) throw new Error(DRAFT_GUARD)
      await write(step)
    }
    await logged(async (warn) => {
      expect((await deliver({ actor, text: "hello", to: "dispatcher" }, deps)).ok).toBe(true)
      expect(typed).toEqual([
        { force: true, surface: SURFACE, text: "hello" },
        { key: "enter", surface: SURFACE },
      ])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain(DRAFT_GUARD)
    })
  })

  test("a send cmux refuses twice before typing is CMUX_FAILED, which the outbox tries again, and every try is logged with cmux's own words", async () => {
    const { deps, typed } = fakes(board())
    deps.write = async () => {
      throw new Error(DRAFT_GUARD)
    }
    await logged(async (warn) => {
      const result = await deliver({ actor, text: "hello", to: "dispatcher" }, deps)
      expect(result).toMatchObject({ code: "CMUX_FAILED", ok: false })
      expect(result.ok ? "" : result.reason).toBe(`The message did not go through: ${DRAFT_GUARD}`)
      expect(typed).toEqual([])
      expect(warn).toHaveBeenCalledTimes(2)
      for (const call of warn.mock.calls) expect(String(call[0])).toContain(DRAFT_GUARD)
    })
  })

  // cmux ends a write that runs past its timeout, so even a first send reported failed may have typed its text; trying again would find the text, and the outbox's retry after the owner pressed Enter would send it twice.
  test("a send killed at cmux's timeout stays INTERRUPTED and is not tried again", async () => {
    const { deps, typed } = fakes(board())
    let writes = 0
    deps.write = async () => {
      writes += 1
      throw new CmuxTimedOut(["send"])
    }
    await logged(async (warn) => {
      const result = await deliver({ actor, text: "hello", to: "dispatcher" }, deps)
      expect(result).toMatchObject({ code: "INTERRUPTED", ok: false })
      expect(result.ok ? "" : result.reason).toContain("The message did not go through")
      expect(writes).toBe(1)
      expect(typed).toEqual([])
      expect(warn).not.toHaveBeenCalled()
    })
  })

  // A read of the Feed that times out has typed nothing and sent nothing, so it is a refusal a retry can pass, not a possibly landed send.
  test("a Feed read that times out before the first send is CMUX_FAILED, not INTERRUPTED, and nothing is typed", async () => {
    const { deps, typed } = fakes(board())
    let reads = 0
    deps.prompts = async () => {
      if (++reads > 1) throw new CmuxTimedOut(["rpc"])
      return []
    }
    await logged(async (warn) => {
      const result = await deliver({ actor, text: "hello", to: "dispatcher" }, deps)
      expect(result).toMatchObject({ code: "CMUX_FAILED", ok: false })
      expect(typed).toEqual([])
      expect(warn).toHaveBeenCalledTimes(2)
    })
  })

  test("the second try reads the screen again, so text that landed after all refuses it rather than joining it", async () => {
    const { deps, typed } = fakes(board())
    const screens = [EMPTY, screen("❯ hello")]
    deps.readScreen = async () => screens.shift() ?? EMPTY
    deps.write = async () => {
      throw new Error(DRAFT_GUARD)
    }
    await logged(async () => {
      expect(await deliver({ actor, text: "hello", to: "dispatcher" }, deps)).toMatchObject({
        code: "INPUT_NOT_EMPTY",
        ok: false,
      })
      expect(typed).toEqual([])
    })
  })

  test("a prompt already in cmux's Feed when typing began does not stop it", async () => {
    const { deps } = fakes(board())
    deps.prompts = async () => ["answered-but-kept"]
    expect((await deliver({ actor, text: "a\nb", to: "dispatcher" }, deps)).ok).toBe(true)
  })

  test("a queued delivery reads the session when its turn comes: a picker the first one raised refuses the second", async () => {
    let state = board()
    const typed: string[] = []
    const deps: DeliverDeps = {
      board: async () => state,
      canForce: async () => true,
      delivered: async () => null,
      now: () => new Date(),
      pressEnter: async () => {},
      prompt: async () => {},
      prompts: async () => [],
      readScreen: async () => EMPTY,
      readSession: async () => state,
      record: async (_, typing) => typing(),
      said: async () => [OLDER],
      skills: async () => new Set(),
      wait: async () => {},
      write: async (step) => {
        await Bun.sleep(1)
        typed.push("text" in step ? step.text : step.key)
        // The first message's Enter makes the session ask the owner something.
        if ("key" in step && step.key === "enter") {
          state = live([worker({ light: "needs-you" })], { "s-dispatcher": SURFACE })
        }
      },
    }
    const [first, second] = await Promise.all([
      deliver({ actor, text: "first", to: "dispatcher" }, deps),
      deliver({ actor, text: "second", to: "dispatcher" }, deps),
    ])
    expect(first.ok).toBe(true)
    expect(second).toMatchObject({ code: "ON_PICKER", ok: false })
    expect(typed).toEqual(["first", "enter"])
  })

  // A fake terminal whose screen shows what has been typed and not yet sent, as read-screen would.
  function terminal(failOnText?: string) {
    let input = ""
    const typed: string[] = []
    const rows = new Map<string, Date>()
    const deps: DeliverDeps = {
      board: async () => board(),
      canForce: async () => true,
      delivered: async (id) => rows.get(id) ?? null,
      now: () => new Date(),
      pressEnter: async () => {},
      prompt: async () => {},
      prompts: async () => [],
      readScreen: async () => (input ? screen(`❯\u00a0${input}`) : EMPTY),
      readSession: async () => board(),
      record: async (event, typing) => {
        await typing()
        if (event.id) rows.set(event.id, new Date())
      },
      said: async () => [OLDER],
      skills: async () => new Set(),
      wait: async () => {},
      write: async (step) => {
        await Bun.sleep(1)
        if ("text" in step && step.text === failOnText) throw new Error("cmux hiccup")
        typed.push("text" in step ? step.text : step.key)
        if ("text" in step) input += step.text
        else if (step.key === "shift+enter") input += "\n"
        else input = ""
      },
    }
    return { deps, typed }
  }

  test("two deliveries to one session type one after the other, never interleaved", async () => {
    const { deps, typed } = terminal()
    await Promise.all([
      deliver({ actor, text: "a1\na2", to: "dispatcher" }, deps),
      deliver({ actor, text: "b1\nb2", to: "dispatcher" }, deps),
    ])
    expect(typed).toEqual(["a1", "shift+enter", "a2", "enter", "b1", "shift+enter", "b2", "enter"])
  })

  // A retry of a request whose answer was lost, as when the dashboard restarts: the row its first try committed answers it.
  test("a message already recorded under its id is answered as delivered, not typed again", async () => {
    const { deps, typed } = terminal()
    const id = "7d0c6a8e-1f2b-4c3d-9e4f-5a6b7c8d9e0f"
    const first = await deliver({ actor, id, text: "once", to: "dispatcher" }, deps)
    const again = await deliver({ actor, id, text: "once", to: "dispatcher" }, deps)
    expect(first.ok).toBe(true)
    expect(again).toMatchObject({ ok: true, sessionId: "s-dispatcher" })
    expect(typed).toEqual(["once", "enter"])
  })

  // The session may answer the message with a picker before the retry arrives: the row still answers it, while a fresh send is refused.
  test("a recorded message is answered as delivered even with its session now on a picker", async () => {
    const { deps, typed } = fakes(board())
    const id = "7d0c6a8e-1f2b-4c3d-9e4f-5a6b7c8d9e0f"
    expect((await deliver({ actor, id, text: "once", to: "dispatcher" }, deps)).ok).toBe(true)
    deps.board = async () => live([worker({ light: "needs-you" })], { "s-dispatcher": SURFACE })
    expect(await deliver({ actor, id, text: "once", to: "dispatcher" }, deps)).toMatchObject({
      ok: true,
      sessionId: "s-dispatcher",
    })
    expect(await deliver({ actor, text: "fresh", to: "dispatcher" }, deps)).toMatchObject({
      code: "ON_PICKER",
    })
    expect(typed).toHaveLength(2)
  })

  // Two live sessions named for the dispatcher: the retry finds the one holding the role, as a send does, so its row still answers it.
  test("with two sessions by the dispatcher's name, a retry to it on a picker reads its recorded time", async () => {
    const { deps, typed } = fakes(board())
    const id = "7d0c6a8e-1f2b-4c3d-9e4f-5a6b7c8d9e0f"
    expect((await deliver({ actor, id, text: "once", to: "dispatcher" }, deps)).ok).toBe(true)
    deps.board = async () =>
      live(
        [
          // the read's own rule has already demoted the newer one to other (workers.ts)
          worker({ light: "needs-you", role: "other", sessionId: "s-new" }),
          worker({ light: "needs-you" }),
        ],
        { "s-dispatcher": SURFACE, "s-new": "SURF-2" },
      )
    expect(await deliver({ actor, id, text: "once", to: "dispatcher" }, deps)).toEqual({
      at: "2026-10-06T12:00:00.000Z",
      ok: true,
      replayed: true,
      sessionId: "s-dispatcher",
    })
    expect(typed).toHaveLength(2)
  })

  test("a retry that arrives while its first try still types waits for it, then is answered as delivered", async () => {
    const { deps, typed } = terminal()
    const id = "7d0c6a8e-1f2b-4c3d-9e4f-5a6b7c8d9e0f"
    const [first, again] = await Promise.all([
      deliver({ actor, id, text: "a1\na2", to: "dispatcher" }, deps),
      deliver({ actor, id, text: "a1\na2", to: "dispatcher" }, deps),
    ])
    expect(first.ok && again.ok).toBe(true)
    expect(typed).toEqual(["a1", "shift+enter", "a2", "enter"])
  })

  // The server stopped part way through typing it: no row was committed, and the half in the input is refused as a draft rather than joined.
  test("a retry after typing was cut off finds the draft and types nothing", async () => {
    const { deps, typed } = terminal("a2")
    const id = "7d0c6a8e-1f2b-4c3d-9e4f-5a6b7c8d9e0f"
    expect(await deliver({ actor, id, text: "a1\na2", to: "dispatcher" }, deps)).toMatchObject({
      code: "INTERRUPTED",
    })
    expect(await deliver({ actor, id, text: "a1\na2", to: "dispatcher" }, deps)).toMatchObject({
      code: "INPUT_NOT_EMPTY",
    })
    expect(typed).toEqual(["a1", "shift+enter"])
  })

  test("a first delivery that fails before typing does not block the second", async () => {
    const { deps, typed } = terminal("a1")
    await logged(async () => {
      const [a, b] = await Promise.all([
        deliver({ actor, text: "a1\na2", to: "dispatcher" }, deps),
        deliver({ actor, text: "b1", to: "dispatcher" }, deps),
      ])
      expect(a).toMatchObject({ code: "CMUX_FAILED" })
      expect(b.ok).toBe(true)
      expect(typed).toEqual(["b1", "enter"])
    })
  })

  test("a first delivery that fails part-way leaves its text in the input, so the second is refused rather than joined to it", async () => {
    const { deps, typed } = terminal("a2")
    const [a, b] = await Promise.all([
      deliver({ actor, text: "a1\na2", to: "dispatcher" }, deps),
      deliver({ actor, text: "b1", to: "dispatcher" }, deps),
    ])
    expect(a).toMatchObject({ code: "INTERRUPTED" })
    expect(b).toMatchObject({ code: "INPUT_NOT_EMPTY" })
    expect(typed).toEqual(["a1", "shift+enter"])
  })

  test("a name that moves to another session while its delivery waits is refused, not typed into the new one", async () => {
    const { deps, typed } = fakes(board())
    deps.readSession = async () =>
      live([worker({ sessionId: "s-renamed" })], { "s-renamed": SURFACE })
    expect(await deliver({ actor, text: "hi", to: "dispatcher" }, deps)).toMatchObject({
      code: "NOT_FOUND",
      ok: false,
    })
    expect(typed).toEqual([])
  })

  // Every record cmux holds took 2.6s to list on 9 Oct, and three such reads a message made each one slow: the board finds the session, and only that session is read again.
  test("finds the session on the board once, then reads only that session: when its turn comes and before the Enter", async () => {
    const { deps } = fakes(board())
    const reads: string[] = []
    deps.board = async () => {
      reads.push("board")
      return board()
    }
    deps.readSession = async (found) => {
      reads.push(found.sessionId)
      return board()
    }
    expect((await deliver({ actor, text: "hi", to: "dispatcher" }, deps)).ok).toBe(true)
    expect(reads).toEqual(["board", "s-dispatcher", "s-dispatcher"])
  })

  test("the session's own read decides over a board a moment old: ended, renamed or on a picker, nothing is typed", async () => {
    const cases: [Live, string][] = [
      [live([], {}), "NOT_FOUND"],
      [live([worker({ name: "dispatcher-2" })], { "s-dispatcher": SURFACE }), "NOT_FOUND"],
      [live([worker({ light: "needs-you" })], { "s-dispatcher": SURFACE }), "ON_PICKER"],
    ]
    for (const [own, code] of cases) {
      const { deps, recorded, typed } = fakes(board())
      deps.readSession = async () => own
      expect(await deliver({ actor, text: "hi", to: "dispatcher" }, deps)).toMatchObject({
        code,
        ok: false,
      })
      expect(typed).toEqual([])
      expect(recorded).toEqual([])
    }
  })

  test("a session's own read that cmux does not answer is CMUX_FAILED, and nothing is typed", async () => {
    const { deps, typed } = fakes(board())
    deps.readSession = async () => {
      throw new Error("cmux did not answer")
    }
    const result = await deliver({ actor, text: "hi", to: "dispatcher" }, deps)
    expect(result).toMatchObject({ code: "CMUX_FAILED", ok: false })
    expect(result.ok ? "" : result.reason).toBe("Could not read cmux: cmux did not answer")
    expect(typed).toEqual([])
  })
})

describe("deliver with attachments", () => {
  const DIR = "/home/x/.playground/attachments"
  const file = (name: string, size: number): Attachment => ({
    id: name,
    kind: name.endsWith(".png") ? "image" : "pdf",
    path: `${DIR}/${name}`,
    size,
  })
  const png = file("11111111-2222-4333-8444-555555555555.png", 300_000)
  const pdf = file("11111111-2222-4333-8444-666666666666.pdf", 1_100_000)

  test("each file's absolute path follows the words on a line of its own, and the record gives the files' count and size, never their names or paths", async () => {
    const { deps, recorded, typed } = fakes(board())
    const result = await deliver(
      { actor, attachments: [png, pdf], text: "look at these", to: "dispatcher" },
      deps,
    )
    expect(result.ok).toBe(true)
    expect(typed).toEqual([
      { force: true, surface: SURFACE, text: "look at these" },
      { key: "shift+enter", surface: SURFACE },
      { key: "shift+enter", surface: SURFACE },
      { force: true, surface: SURFACE, text: `Attached: ${png.path}` },
      { key: "shift+enter", surface: SURFACE },
      { force: true, surface: SURFACE, text: `Attached: ${pdf.path}` },
      { key: "enter", surface: SURFACE },
    ])
    expect(recorded).toEqual([
      "Sent dispatcher a message of 13 characters with 2 attachments of 1.3 MB",
    ])
    expect(recorded[0]).not.toContain("1111")
    expect(recorded[0]).not.toContain(DIR)
  })

  test("files alone go, and the message starts with a word rather than a path", async () => {
    const { deps, recorded, typed } = fakes(board())
    expect(
      (await deliver({ actor, attachments: [png], text: "  ", to: "dispatcher" }, deps)).ok,
    ).toBe(true)
    expect(typed).toEqual([
      { force: true, surface: SURFACE, text: `Attached: ${png.path}` },
      { key: "enter", surface: SURFACE },
    ])
    expect(recorded).toEqual(["Sent dispatcher 1 attachment of 293 KB"])
  })

  test("a leading / or ! is still a command when files come with it, and nothing is typed", async () => {
    for (const text of ["/clear", "!ls", "\u200B/exit"]) {
      const { deps, recorded, typed } = fakes(board())
      expect(
        await deliver({ actor, attachments: [png], text, to: "dispatcher" }, deps),
      ).toMatchObject({ code: "COMMAND", ok: false })
      expect(typed).toEqual([])
      expect(recorded).toEqual([])
    }
  })

  test("a session on a picker, or an input holding a draft, refuses a message with files as it refuses words", async () => {
    const onPicker = fakes(live([worker({ light: "needs-you" })], { "s-dispatcher": SURFACE }))
    expect(
      await deliver({ actor, attachments: [png], text: "", to: "dispatcher" }, onPicker.deps),
    ).toMatchObject({ code: "ON_PICKER" })
    const drafted = fakes(board())
    drafted.deps.readScreen = async () => screen("❯ half a thought")
    expect(
      await deliver({ actor, attachments: [png], text: "hi", to: "dispatcher" }, drafted.deps),
    ).toMatchObject({ code: "INPUT_NOT_EMPTY" })
    expect([...onPicker.typed, ...drafted.typed]).toEqual([])
  })

  test("the caps count the person's words: the Attached lines come on top, so words that fit still go with their files", async () => {
    const long = fakes(board())
    expect(
      (
        await deliver(
          { actor, attachments: [png], text: "x".repeat(MAX_CHARS - 50), to: "dispatcher" },
          long.deps,
        )
      ).ok,
    ).toBe(true)
    const tall = fakes(board())
    const lines = Array(MAX_LINES).fill("x").join("\n")
    expect(
      (await deliver({ actor, attachments: [png, pdf], text: lines, to: "dispatcher" }, tall.deps))
        .ok,
    ).toBe(true)
    expect(tall.typed.at(-2)).toEqual({
      force: true,
      surface: SURFACE,
      text: `Attached: ${pdf.path}`,
    })
    const over = fakes(board())
    expect(
      await deliver(
        { actor, attachments: [png], text: "x".repeat(MAX_CHARS + 1), to: "dispatcher" },
        over.deps,
      ),
    ).toMatchObject({
      code: "TOO_LONG",
      reason: `A message holds at most ${MAX_CHARS} characters.`,
    })
  })

  test("a total just under a megabyte reads as one, not 1024 KB", async () => {
    const { deps, recorded } = fakes(board())
    await deliver(
      { actor, attachments: [file(png.id, 1_048_300)], text: "", to: "dispatcher" },
      deps,
    )
    expect(recorded).toEqual(["Sent dispatcher 1 attachment of 1.0 MB"])
  })

  test("more files than a message holds are refused", async () => {
    const { deps, typed } = fakes(board())
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, () => png)
    expect(
      await deliver({ actor, attachments: many, text: "hi", to: "dispatcher" }, deps),
    ).toMatchObject({ code: "TOO_LONG" })
    expect(typed).toEqual([])
  })
})

// deliver() types into a session's pane as if the owner typed it, so only the owner's own clicks reach it, and nothing else speaks for the owner: the composer and the owner's answer to an inbox item. An ops job, a script or any other route sends through SendMessage instead.
const ROOT = join(import.meta.dir, "../../../../../..")
const DELIVER = "api/hono/src/lib/dashboard/deliver.ts"
const CALLERS = ["api/hono/src/routers/dashboard.ts", "api/hono/src/routers/inbox.ts"]
const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const DELIVER_MODULE = /["'][^"']*\/deliver(?:\.[cm]?[jt]sx?)?["']/
const DELIVER_STAR = /\*\s*(?:as\s+[\w$]+\s*)?from\s*["'][^"']*\/deliver(?:\.[cm]?[jt]sx?)?["']/
const SPECIFIER = /\bfrom\s*["'][^"']*["']|\bimport\s*\(\s*["'][^"']*["']\s*\)/g
const transpiler = new Bun.Transpiler({ deadCodeElimination: false, loader: "tsx" })

// Each source file, other than deliver.ts, that reaches deliver(): it names deliver beside a module ending in /deliver, or takes that module whole.
const deliverCallers = (files: Record<string, string>): string[] =>
  Object.entries(files)
    .filter(([path, source]) => {
      if (path === DELIVER) return false
      let code = source
      try {
        code = transpiler.transformSync(source)
      } catch {}
      if (!DELIVER_MODULE.test(code)) return false
      return /\bdeliver\b/.test(code.replace(SPECIFIER, "")) || DELIVER_STAR.test(code)
    })
    .map(([path]) => path)

describe("who calls deliver()", () => {
  test("only the composer's and the ask answer's routes", async () => {
    const listed = Bun.spawnSync(
      ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
      {
        cwd: ROOT,
        stdin: "ignore",
      },
    )
    expect(listed.exitCode).toBe(0)
    const files: Record<string, string> = {}
    for (const path of listed.stdout.toString().split("\n")) {
      if (!SOURCE.test(path) || path.startsWith("tests/") || path.endsWith(".d.ts")) continue
      const file = Bun.file(join(ROOT, path))
      if (await file.exists()) files[path] = await file.text()
    }
    expect(Object.keys(files)).toContain(DELIVER)
    expect(deliverCallers(files).sort()).toEqual(CALLERS)
  })

  test("an import, a dynamic import or a star import of deliver counts; a sibling export or a comment does not", () => {
    const calling = {
      "dynamic.ts": 'const m = await import("@/lib/dashboard/deliver")\nawait m.deliver(d)',
      "named.ts": 'import { deliver } from "@/lib/dashboard/deliver"\nawait deliver(d)',
      "renamed.ts": 'import { deliver as send } from "../dashboard/deliver.ts"\nawait send(d)',
      "star.ts": 'import * as d from "@/lib/dashboard/deliver"\nawait d.deliver(x)',
    }
    const clear = {
      "comment.ts":
        '// deliver() in deliver.ts types it\nimport { normalize } from "@/lib/dashboard/deliver"\nnormalize("x")',
      "otherstar.ts":
        'import { normalize } from "@/lib/dashboard/deliver"\nimport * as z from "zod"\nnormalize(z.string().parse("x"))',
      [DELIVER]: "export async function deliver() {}",
    }
    expect(deliverCallers({ ...calling, ...clear }).sort()).toEqual(Object.keys(calling).sort())
  })
})

// The one route beside deliver()'s that types into a pane: a herdr prompt's answer, the owner's own Submit on its card, which answerFeed() hands to answerHerdr() past its guards: the same contract as deliver() for the composer and answerFeed() for cmux. cmux.test.ts holds typeKeys() to feed.ts.
const HERDR_ANSWER_ROUTE = {
  file: "api/hono/src/routers/dashboard.ts",
  path: "/workers/:sessionId/feed/:requestId",
}

describe("the herdr answer route", () => {
  test("answerFeed() is reached from the dashboard router's feed route alone", async () => {
    const listed = Bun.spawnSync(
      ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: ROOT, stdin: "ignore" },
    )
    expect(listed.exitCode).toBe(0)
    const callers: string[] = []
    for (const path of listed.stdout.toString().split("\n")) {
      if (
        !SOURCE.test(path) ||
        path.startsWith("tests/") ||
        path === "api/hono/src/lib/dashboard/feed.ts"
      )
        continue
      const file = Bun.file(join(ROOT, path))
      if (!(await file.exists())) continue
      let code = await file.text()
      try {
        code = transpiler.transformSync(code)
      } catch {}
      if (
        /["'][^"']*\/feed(?:\.[cm]?[jt]sx?)?["']/.test(code) &&
        /\banswerFeed\b/.test(code.replace(SPECIFIER, ""))
      )
        callers.push(path)
    }
    expect(callers).toEqual([HERDR_ANSWER_ROUTE.file])
    const router = await Bun.file(join(ROOT, HERDR_ANSWER_ROUTE.file)).text()
    expect(router).toContain(`"${HERDR_ANSWER_ROUTE.path}"`)
  })
})

describe("deliver to a herdr session", () => {
  const HERDR = "herdr:factory:w1:p1"
  // A herdr session's board and a terminal that takes its message as one agent.prompt, which `fail` refuses as herdr would.
  function herdr(fail?: unknown) {
    const state = live([worker()], { "s-dispatcher": HERDR })
    const sent: { surface: string; text: string }[] = []
    const recorded: string[] = []
    const { deps } = fakes(state)
    deps.canForce = async () => {
      throw new Error("cmux is not asked for --force")
    }
    deps.prompts = async () => {
      throw new Error("cmux's Feed is not read")
    }
    deps.write = async () => {
      throw new Error("nothing is typed key by key")
    }
    // as the real record's transaction, a row stands only once the typing went whole
    deps.record = async (event, typing) => {
      await typing()
      recorded.push(event.summary)
    }
    deps.prompt = async (surface, text) => {
      if (fail) throw fail
      sent.push({ surface, text })
    }
    return { deps, recorded, sent }
  }

  test("the whole message goes as one prompt to its pane, after the input box reads empty", async () => {
    const { deps, recorded, sent } = herdr()
    const read: string[] = []
    deps.readScreen = async (surface) => {
      read.push(surface)
      return EMPTY
    }
    const result = await deliver({ actor, text: "line one\nline two", to: "dispatcher" }, deps)
    expect(result).toMatchObject({ ok: true, sessionId: "s-dispatcher" })
    expect(sent).toEqual([{ surface: HERDR, text: "line one\nline two" }])
    // once before the send, and once after it to see the box empty
    expect(read).toEqual([HERDR, HERDR])
    expect(recorded).toHaveLength(1)
  })

  // herdr pastes the message and then presses Enter, and the Enter can land while Claude Code is still taking a pasted image's path in, so the message sat unsent in dispatcher's box and every later delivery read it as a draft
  describe("the box read after the send", () => {
    const MESSAGE = "Is send on the right? why"
    const HELD = screen(`❯ ${MESSAGE}`)
    const NO_BOX = "a screen with no rules to frame a box"
    // the box empty before the send, then each read after it from `first` until an Enter, then from `second`, the last of each repeating; an Error read throws
    function after(
      first: (string | Error)[],
      second: (string | Error)[] = [EMPTY],
      fail?: unknown,
    ) {
      const run = herdr(fail)
      let reads = [EMPTY, ...first]
      const enters: string[] = []
      const waits: number[] = []
      let count = 0
      run.deps.readScreen = async () => {
        count += 1
        const read = reads.length > 1 ? reads.shift() : reads[0]
        if (read instanceof Error) throw read
        return read ?? EMPTY
      }
      run.deps.pressEnter = async (surface) => {
        enters.push(surface)
        reads = [...second]
      }
      run.deps.wait = async (ms) => {
        waits.push(ms)
      }
      const send = (id?: string) =>
        deliver({ actor, id, text: MESSAGE, to: "dispatcher" }, run.deps)
      return { ...run, enters, reads: () => count, send, waits }
    }

    test("a clean send finds the box empty after one gap, and presses nothing more", async () => {
      const { enters, reads, recorded, send, sent, waits } = after([EMPTY])
      expect(await send()).toMatchObject({ ok: true })
      expect(sent).toHaveLength(1)
      expect(enters).toEqual([])
      expect(reads()).toBe(2)
      expect(waits).toEqual([SETTLE_GAP_MS])
      expect(recorded).toHaveLength(1)
    })

    // Claude Code takes the Enter a frame or more after herdr sends it, so a box still drawn holding the message is read again before it gets an Enter
    test("a box that empties on its second read went, with no Enter", async () => {
      const { enters, reads, send } = after([HELD, EMPTY])
      expect(await send()).toMatchObject({ ok: true })
      expect(enters).toEqual([])
      expect(reads()).toBe(3)
    })

    // the frames a live 18-column pane drew: the paste wrapped, then, the session busy, the message queued and the queue hint cut off at the pane's edge until its turn ended
    test("a busy narrow pane that queues the message went, with no Enter", async () => {
      const { enters, recorded, send } = after([
        narrow("❯ Is send on the", "  right? why"),
        narrow("❯ Press up to edi…"),
      ])
      expect(await send()).toMatchObject({ ok: true })
      expect(enters).toEqual([])
      expect(recorded).toHaveLength(1)
    })

    test("a message whose Enter was lost gets one more Enter, and goes", async () => {
      const { enters, reads, send } = after([HELD], [HELD, EMPTY])
      expect(await send()).toMatchObject({ ok: true })
      expect(enters).toEqual([HERDR])
      expect(reads()).toBe(1 + SETTLE_READS + 2)
    })

    test("a box that never empties, after one more Enter, is typed but not submitted", async () => {
      const { enters, reads, recorded, send, waits } = after([HELD], [HELD])
      const result = await send()
      expect(result).toMatchObject({ code: "INTERRUPTED", ok: false })
      expect(result.ok ? "" : result.reason).toContain("typed but not submitted")
      expect(enters).toEqual([HERDR])
      expect(reads()).toBe(1 + 2 * SETTLE_READS)
      expect(waits).toEqual(Array(2 * SETTLE_READS).fill(SETTLE_GAP_MS))
      expect(recorded).toEqual([])
    })

    test("a box holding someone else's text gets no Enter, and reads interrupted", async () => {
      const { enters, recorded, send } = after([screen("❯ half a thought of his own")])
      expect(await send()).toMatchObject({ code: "INTERRUPTED", ok: false })
      expect(enters).toEqual([])
      expect(recorded).toEqual([])
    })

    test("a screen that frames no box after the send gets no Enter, and reads interrupted", async () => {
      const { enters, recorded, send } = after([NO_BOX])
      const result = await send()
      expect(result).toMatchObject({ code: "INTERRUPTED", ok: false })
      expect(result.ok ? "" : result.reason).toContain("Cannot find")
      expect(enters).toEqual([])
      expect(recorded).toEqual([])
    })

    test("a screen that cannot be read after the send, or an Enter herdr refuses, reads interrupted", async () => {
      const unread = after([new Error("pane gone")])
      expect(await unread.send()).toMatchObject({ code: "INTERRUPTED", ok: false })
      expect(unread.recorded).toEqual([])
      const refused = after([HELD])
      refused.deps.pressEnter = async () => {
        throw new Error("no such pane")
      }
      expect(await refused.send()).toMatchObject({ code: "INTERRUPTED", ok: false })
      expect(refused.recorded).toEqual([])
    })

    // an outbox message is retried on its own, so one left unsent in the box waits for its next try's Enter rather than failing in front of the owner
    test("a box that never empties, for a message with an id, is queued for another Enter, not failed", async () => {
      const { enters, recorded, send } = after([HELD], [HELD])
      const result = await send("11111111-2222-4333-8444-000000000001")
      expect(result).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false, pasted: true })
      expect(result.ok ? "" : result.reason).toContain("unsent")
      expect(enters).toEqual([HERDR])
      expect(recorded).toEqual([])
    })

    test("its retry presses Enter on the message in the box and pastes nothing again", async () => {
      const id = "11111111-2222-4333-8444-000000000002"
      const run = after([HELD], [HELD])
      expect(await run.send(id)).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
      run.deps.readScreen = async () => (run.enters.length < 2 ? HELD : EMPTY)
      expect(await run.send(id)).toMatchObject({ ok: true })
      expect(run.sent).toHaveLength(1)
      expect(run.enters).toEqual([HERDR, HERDR])
      expect(run.recorded).toHaveLength(1)
    })

    // the owner pressed Enter in the terminal (03:13Z on 24 Oct), so the box is empty when the retry comes: typing it again would send it twice
    test("its retry after the message left the box by hand types nothing and reads it delivered", async () => {
      const id = "11111111-2222-4333-8444-000000000003"
      const run = after([HELD], [HELD])
      expect(await run.send(id)).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
      run.deps.readScreen = async () => EMPTY
      expect(await run.send(id)).toMatchObject({ ok: true })
      expect(run.sent).toHaveLength(1)
      expect(run.enters).toEqual([HERDR])
      expect(run.recorded).toHaveLength(1)
    })

    // 24 Oct 02:58Z: dispatcher's box held the owner's image message, pasted and never submitted, which every later try refused as a draft until the owner pressed Enter in the terminal; the box's shape is the one dispatcher's transcript recorded at 03:13Z
    test("an image message whose settle read the box empty before its paste was drawn gets its Enter from the next message, which then goes", async () => {
      const { deps, recorded, sent } = herdr()
      const words = "I have Linear status twice. We can remove the next block, no?"
      const png: Attachment = {
        id: "a.png",
        kind: "image",
        path: "/home/x/.playground/attachments/11111111-2222-4333-8444-555555555555.png",
        size: 9000,
      }
      const id = "11111111-2222-4333-8444-000000000004"
      const stuckBox = screen(`❯ [Image #6]${words}`, "  Attached:")
      const enters: string[] = []
      let drawn = false
      deps.pressEnter = async (surface) => {
        enters.push(surface)
        drawn = false
      }
      // its own settle reads the box empty before the paste is drawn, so it reads sent, as the live dashboard's log shows (200 in 2s); the paste is drawn after
      deps.readScreen = async () => (drawn ? stuckBox : EMPTY)
      const message = { actor, attachments: [png], text: words, to: "dispatcher" }
      expect(await deliver({ ...message, id }, deps)).toMatchObject({ ok: true })
      drawn = true
      // the next message from the composer finds the box holding that paste: it presses Enter on it, then pastes its own
      const next = await deliver(
        { actor, id: "11111111-2222-4333-8444-000000000005", text: "and this", to: "dispatcher" },
        deps,
      )
      expect(next).toMatchObject({ ok: true })
      expect(enters).toEqual([HERDR])
      expect(sent.map((s) => s.text)).toEqual([withAttachments(words, [png]), "and this"])
      expect(recorded).toHaveLength(2)
    })

    // a reviewer: Claude Code folds a paste of more than 2 line breaks or 800 characters into [Pasted text #n +k lines], k its line breaks, so a long message stuck the 24 Oct way is known by that count
    test("an earlier paste Claude Code folded gets its Enter from the next message when the fold counts its line breaks", async () => {
      const { deps, recorded, sent } = herdr()
      const words = "one\n\ntwo\n\nthree"
      const enters: string[] = []
      let box = EMPTY
      deps.pressEnter = async (surface) => {
        enters.push(surface)
        box = EMPTY
      }
      deps.readScreen = async () => box
      const first = {
        actor,
        id: "11111111-2222-4333-8444-000000000010",
        text: words,
        to: "dispatcher",
      }
      expect(await deliver(first, deps)).toMatchObject({ ok: true })
      box = screen("❯ [Pasted text #1 +3 lines]")
      const other = {
        actor,
        id: "11111111-2222-4333-8444-000000000011",
        text: "and this",
        to: "dispatcher",
      }
      expect(await deliver(other, deps)).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
      expect(enters).toEqual([])
      box = screen("❯ [Pasted text #1 +4 lines]")
      expect(await deliver(other, deps)).toMatchObject({ ok: true })
      expect(enters).toEqual([HERDR])
      expect(sent.map((s) => s.text)).toEqual([words, "and this"])
      expect(recorded).toHaveLength(2)
    })

    // a reviewer: the message whose Enter sent an earlier held one leaves it unsent in memory, so that one's own retry reads it gone and types nothing
    test("a held message another message's Enter sent reads delivered on its own retry, typing nothing", async () => {
      const { deps, sent } = herdr()
      const enters: string[] = []
      let box = EMPTY
      deps.prompt = async (surface, text) => {
        sent.push({ surface, text })
        if (text === "the held one") box = screen("❯ the held one")
      }
      deps.pressEnter = async (surface) => {
        enters.push(surface)
        if (enters.length > 1) box = EMPTY
      }
      deps.readScreen = async () => box
      const held = {
        actor,
        id: "11111111-2222-4333-8444-000000000015",
        text: "the held one",
        to: "dispatcher",
      }
      expect(await deliver(held, deps)).toMatchObject({ code: "INPUT_NOT_EMPTY", pasted: true })
      const other = {
        actor,
        id: "11111111-2222-4333-8444-000000000016",
        text: "another",
        to: "dispatcher",
      }
      expect(await deliver(other, deps)).toMatchObject({ ok: true })
      expect(await deliver(held, deps)).toMatchObject({ ok: true })
      expect(sent.map((s) => s.text)).toEqual(["the held one", "another"])
      expect(enters).toEqual([HERDR, HERDR])
    })

    test("a later message waits, typing nothing, while an earlier paste of the dashboard's stays in the box after its Enter", async () => {
      const { deps, recorded, sent } = herdr()
      const enters: string[] = []
      let drawn = false
      deps.pressEnter = async (surface) => {
        enters.push(surface)
      }
      deps.readScreen = async () => (drawn ? screen("❯ the first, still stuck") : EMPTY)
      const first = {
        actor,
        id: "11111111-2222-4333-8444-000000000006",
        text: "the first, still stuck",
      }
      expect(await deliver({ ...first, to: "dispatcher" }, deps)).toMatchObject({ ok: true })
      drawn = true
      const next = await deliver(
        { actor, id: "11111111-2222-4333-8444-000000000007", text: "the second", to: "dispatcher" },
        deps,
      )
      expect(next).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
      expect(next).not.toHaveProperty("pasted")
      expect(enters).toEqual([HERDR])
      expect(sent.map((s) => s.text)).toEqual(["the first, still stuck"])
      expect(recorded).toHaveLength(1)
    })

    // a reviewer: Up in the terminal recalls a message that went back into the box, which must never be sent again
    test("a box holding a paste the transcript shows went is the owner's recall, and holds with no Enter", async () => {
      const { deps, recorded, sent } = herdr()
      const enters: string[] = []
      let went = false
      deps.pressEnter = async (surface) => {
        enters.push(surface)
      }
      deps.said = async () =>
        went
          ? [
              OLDER,
              { ...OLDER, at: "2026-10-06T12:00:01.000Z", id: "e1", text: "the recalled one" },
            ]
          : [OLDER]
      deps.readScreen = async () => (went ? screen("❯ the recalled one") : EMPTY)
      const first = { actor, id: "11111111-2222-4333-8444-00000000000a", text: "the recalled one" }
      expect(await deliver({ ...first, to: "dispatcher" }, deps)).toMatchObject({ ok: true })
      went = true
      const next = await deliver(
        { actor, id: "11111111-2222-4333-8444-00000000000b", text: "the next", to: "dispatcher" },
        deps,
      )
      expect(next).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
      expect(enters).toEqual([])
      expect(sent.map((s) => s.text)).toEqual(["the recalled one"])
      expect(recorded).toHaveLength(1)
    })

    // a reviewer: a transcript read that does not reach back to the paste cannot show it did not go, so the box holds
    test("a remembered paste the transcript read does not reach back to holds with no Enter", async () => {
      const { deps, sent } = herdr()
      const enters: string[] = []
      let drawn = false
      deps.pressEnter = async (surface) => {
        enters.push(surface)
      }
      deps.said = async () => [{ ...OLDER, at: "2026-10-06T12:30:00.000Z", kind: "assistant" }]
      deps.readScreen = async () => (drawn ? screen("❯ an old one, out of reach") : EMPTY)
      const first = {
        actor,
        id: "11111111-2222-4333-8444-00000000000c",
        text: "an old one, out of reach",
      }
      expect(await deliver({ ...first, to: "dispatcher" }, deps)).toMatchObject({ ok: true })
      drawn = true
      const next = await deliver(
        { actor, id: "11111111-2222-4333-8444-00000000000d", text: "the next", to: "dispatcher" },
        deps,
      )
      expect(next).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
      expect(enters).toEqual([])
      expect(sent).toHaveLength(1)
    })

    // a reviewer: a message of files alone has no first line of words, so its transcript entry is matched by its files
    test("a message of files alone the transcript shows went is the owner's recall, and holds with no Enter", async () => {
      const { deps, sent } = herdr()
      const png: Attachment = {
        id: "c.png",
        kind: "image",
        path: "/home/x/.playground/attachments/11111111-2222-4333-8444-777777777777.png",
        size: 9000,
      }
      const enters: string[] = []
      let went = false
      deps.pressEnter = async (surface) => {
        enters.push(surface)
      }
      deps.said = async () =>
        went
          ? [
              OLDER,
              {
                ...OLDER,
                at: "2026-10-06T12:00:01.000Z",
                attachments: [{ id: null, kind: "image" as const }],
                id: "e2",
                text: "",
              },
            ]
          : [OLDER]
      deps.readScreen = async () => (went ? screen("❯ [Image #3]", "  Attached:") : EMPTY)
      const first = {
        actor,
        attachments: [png],
        id: "11111111-2222-4333-8444-00000000000e",
        text: "",
      }
      expect(await deliver({ ...first, to: "dispatcher" }, deps)).toMatchObject({ ok: true })
      went = true
      const next = await deliver(
        { actor, id: "11111111-2222-4333-8444-00000000000f", text: "the next", to: "dispatcher" },
        deps,
      )
      expect(next).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
      expect(enters).toEqual([])
      expect(sent).toHaveLength(1)
    })

    // Claude Code folds a long paste into one mark, so its words cannot be read: a fold is taken as a paste of the dashboard's only when that paste would fold and its line breaks are the fold's count
    test("a retry presses Enter on its own paste folded into [Pasted text #n +k lines], and not on a fold of another count or of a message too short to fold", async () => {
      const { deps, sent } = herdr()
      const words = "seven\n\neight\n\nnine"
      const enters: string[] = []
      let box = EMPTY
      deps.prompt = async (surface, text) => {
        sent.push({ surface, text })
        box = screen("❯ [Pasted text #1 +4 lines]")
      }
      deps.pressEnter = async (surface) => {
        enters.push(surface)
      }
      deps.readScreen = async () => box
      const message = {
        actor,
        id: "11111111-2222-4333-8444-000000000012",
        text: words,
        to: "dispatcher",
      }
      expect(await deliver(message, deps)).toMatchObject({ code: "INPUT_NOT_EMPTY", pasted: true })
      expect(enters).toEqual([HERDR])
      // a reviewer: the owner cleared it and pasted a long text of their own
      box = screen("❯ [Pasted text #2 +2 lines]")
      expect(await deliver(message, deps)).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
      expect(enters).toEqual([HERDR])
      box = screen("❯ [Pasted text #1 +4 lines]")
      deps.pressEnter = async (surface) => {
        enters.push(surface)
        box = EMPTY
      }
      expect(await deliver(message, deps)).toMatchObject({ ok: true })
      expect(enters).toEqual([HERDR, HERDR])
      expect(sent).toHaveLength(1)
      deps.prompt = async (surface, text) => {
        sent.push({ surface, text })
      }
      const short = {
        actor,
        id: "11111111-2222-4333-8444-000000000013",
        text: "too short to fold",
        to: "dispatcher",
      }
      expect(await deliver(short, deps)).toMatchObject({ ok: true })
      box = screen("❯ [Pasted text #3]")
      const next = {
        actor,
        id: "11111111-2222-4333-8444-000000000014",
        text: "the next",
        to: "dispatcher",
      }
      expect(await deliver(next, deps)).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
      expect(enters).toEqual([HERDR, HERDR])
      expect(sent).toHaveLength(2)
    })

    test("a box holding other words, or this message with more, still holds and gets nothing", async () => {
      for (const box of [`❯ ${MESSAGE} and more`, "❯ Is send on the", `❯ [Image #1]${MESSAGE}`]) {
        const { deps, recorded, sent } = herdr()
        const enters: string[] = []
        deps.pressEnter = async (surface) => {
          enters.push(surface)
        }
        deps.readScreen = async () => screen(box)
        const result = await deliver({ actor, text: MESSAGE, to: "dispatcher" }, deps)
        expect(result).toMatchObject({ code: "INPUT_NOT_EMPTY", ok: false })
        expect(sent).toEqual([])
        expect(enters).toEqual([])
        expect(recorded).toEqual([])
      }
    })

    // a prompt that failed as typed may have gone or never been pasted, which an empty box cannot tell, so it stays interrupted; the message seen in the box is ours, and an Enter sends it
    test("after a prompt that failed as typed, only the message seen and then sent counts", async () => {
      const stalled = new HerdrRefused("agent.prompt", "agent_prompt_stalled", "")
      const empty = after([EMPTY], [EMPTY], stalled)
      expect(await empty.send()).toMatchObject({ code: "INTERRUPTED", ok: false })
      expect(empty.enters).toEqual([])
      const seen = after([HELD], [EMPTY], stalled)
      expect(await seen.send()).toMatchObject({ ok: true })
      expect(seen.enters).toEqual([HERDR])
    })
  })

  // The outbox reads a message delivered only when the transcript holds its words and files exactly, so the prompt carries the Attached lines as cmux types them
  test("a message's files go in the same prompt, one Attached line each after a blank line", async () => {
    const { deps, recorded, sent } = herdr()
    const DIR = "/home/x/.playground/attachments"
    const png: Attachment = {
      id: "a.png",
      kind: "image",
      path: `${DIR}/11111111-2222-4333-8444-555555555555.png`,
      size: 300_000,
    }
    const pdf: Attachment = {
      id: "b.pdf",
      kind: "pdf",
      path: `${DIR}/11111111-2222-4333-8444-666666666666.pdf`,
      size: 1_100_000,
    }
    const result = await deliver(
      { actor, attachments: [png, pdf], text: "line one\nline two", to: "dispatcher" },
      deps,
    )
    expect(result.ok).toBe(true)
    expect(sent).toEqual([
      {
        surface: HERDR,
        text: `line one\nline two\n\nAttached: ${png.path}\nAttached: ${pdf.path}`,
      },
    ])
    expect(recorded).toEqual([
      "Sent dispatcher a message of 17 characters on 2 lines with 2 attachments of 1.3 MB",
    ])
  })

  // A herdr pane's id changes when it moves, so the session read once more before the send decides where it goes, and a name that now holds another session sends nothing.
  test("the message goes where the session is at the send, and never to another session", async () => {
    const moved = herdr()
    let screened = false
    moved.deps.readScreen = async () => {
      screened = true
      return EMPTY
    }
    moved.deps.readSession = async () =>
      screened
        ? live([worker()], { "s-dispatcher": "herdr:factory:w2:p1" })
        : live([worker()], { "s-dispatcher": HERDR })
    expect(await deliver({ actor, text: "hi", to: "dispatcher" }, moved.deps)).toMatchObject({
      ok: true,
    })
    expect(moved.sent).toEqual([{ surface: "herdr:factory:w2:p1", text: "hi" }])

    const other = herdr()
    screened = false
    other.deps.readScreen = moved.deps.readScreen
    other.deps.readSession = async () =>
      screened
        ? live([worker({ sessionId: "s-other" })], { "s-other": HERDR })
        : live([worker()], { "s-dispatcher": HERDR })
    expect(await deliver({ actor, text: "hi", to: "dispatcher" }, other.deps)).toMatchObject({
      code: "NOT_FOUND",
      ok: false,
    })
    expect(other.sent).toEqual([])
  })

  test("a draft in its input box refuses before anything is sent", async () => {
    const { deps, sent } = herdr()
    deps.readScreen = async () => screen("❯ half a thought")
    expect(await deliver({ actor, text: "hi", to: "dispatcher" }, deps)).toMatchObject({
      code: "INPUT_NOT_EMPTY",
    })
    expect(sent).toEqual([])
  })

  test("herdr's refusals map as #910 lists them", async () => {
    const cases: [unknown, string][] = [
      [new HerdrRefused("agent.prompt", "agent_blocked", ""), "ON_PICKER"],
      [new HerdrRefused("agent.prompt", "agent_not_running", ""), "NOT_FOUND"],
      [new HerdrRefused("agent.prompt", "not_found", ""), "NOT_FOUND"],
      [new HerdrRefused("agent.prompt", "timeout", ""), "INTERRUPTED"],
      [new HerdrRefused("agent.prompt", "agent_prompt_stalled", ""), "INTERRUPTED"],
      [new HerdrTimedOut("agent.prompt"), "INTERRUPTED"],
      [new HerdrDown("connect ENOENT"), "CMUX_FAILED"],
      [new HerdrRefused("agent.prompt", "invalid_request", ""), "CMUX_FAILED"],
    ]
    for (const [error, code] of cases) {
      const { deps } = herdr(error)
      expect(await deliver({ actor, text: "hi", to: "dispatcher" }, deps)).toMatchObject({
        code,
        ok: false,
      })
    }
  })

  test("a refusal that sent nothing is tried once more at once, as a cmux send is", async () => {
    let tries = 0
    const { deps, sent } = herdr()
    deps.prompt = async (surface, text) => {
      tries += 1
      if (tries === 1) throw new HerdrDown("connect ECONNREFUSED")
      sent.push({ surface, text })
    }
    expect((await deliver({ actor, text: "hi", to: "dispatcher" }, deps)).ok).toBe(true)
    expect(tries).toBe(2)
  })

  test("a session found on a prompt when its turn comes is not sent to", async () => {
    const { deps, sent } = herdr()
    deps.readSession = async () => live([worker({ light: "needs-you" })], { "s-dispatcher": HERDR })
    expect(await deliver({ actor, text: "hi", to: "dispatcher" }, deps)).toMatchObject({
      code: "ON_PICKER",
    })
    expect(sent).toEqual([])
  })
})
