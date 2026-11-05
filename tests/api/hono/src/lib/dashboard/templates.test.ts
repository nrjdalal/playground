import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { NEEDS_ACCOUNT, refusalOf, secondAccount, startTemplate, templateArgv } =
  await import("../../../../../../api/hono/src/lib/dashboard/templates")
// The settings package as the API resolves it, since its source's @/ paths resolve only under its own config (tests/packages/settings holds its schema's tests).
const { readSessionTemplates } = await import(
  Bun.resolveSync(
    "@packages/settings",
    new URL("../../../../../../api/hono/src", import.meta.url).pathname,
  )
)
type Run = import("../../../../../../api/hono/src/lib/dashboard/templates").Run
type SessionTemplate = Parameters<typeof templateArgv>[0]["template"]

const ROOT = "/fixture/playground"
const SPAWN = `${ROOT}/scripts/spawn.sh`
const scratch = mkdtempSync(join(tmpdir(), "templates-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// A data folder with no policy reads the defaults.
const DEFAULTS: SessionTemplate[] = readSessionTemplates(mkdtempSync(join(scratch, "empty-")))
const byId = (id: string) => DEFAULTS.find((t) => t.id === id)!

const argv = (id: string, name: string, account?: string) =>
  templateArgv({ account, dispatcher: "dispatcher", name, root: ROOT, template: byId(id) })

describe("templateArgv, each default template", () => {
  test("Assistant writes its roster row reporting to the dispatcher, then starts in spawn.sh's manager mode", () => {
    expect(argv("assistant", "b7k2mq-assistant")).toEqual({
      steps: [
        [
          "bun",
          `${ROOT}/scripts/roster.ts`,
          "set",
          "b7k2mq-assistant",
          "kind=assistant",
          "reportsTo=dispatcher",
          "task=Assistant",
        ],
        [SPAWN, "manager", "b7k2mq-assistant", "brief-b7k2mq-assistant.md"],
      ],
    })
  })

  test("Orchestrator writes a manager kind's roster row first, then starts", () => {
    expect(argv("orchestrator", "c8m3nr-builder")).toEqual({
      steps: [
        [
          "bun",
          `${ROOT}/scripts/roster.ts`,
          "set",
          "c8m3nr-builder",
          "kind=builder",
          "reportsTo=dispatcher",
          "task=Orchestrator",
        ],
        [SPAWN, "manager", "c8m3nr-builder", "brief-c8m3nr-builder.md"],
      ],
    })
  })

  test("Second dispatcher on Claude starts on the account it is given, and with none is refused with the owner's next step", () => {
    expect(argv("second-dispatcher-claude", "dispatcher-2", "second@example.test")).toEqual({
      steps: [
        [
          SPAWN,
          "manager",
          "dispatcher-2",
          "brief-dispatcher-2.md",
          "--account",
          "second@example.test",
        ],
      ],
    })
    expect(argv("second-dispatcher-claude", "dispatcher-2")).toEqual({ error: NEEDS_ACCOUNT })
  })

  test("Second dispatcher on GLM starts on GLM's backend, with no roster step", () => {
    expect(argv("second-dispatcher-glm", "dispatcher-2")).toEqual({
      steps: [[SPAWN, "manager", "dispatcher-2", "brief-dispatcher-2.md", "--backend", "glm"]],
    })
  })

  test("a template's model and effort reach spawn.sh's flags", () => {
    const template = { ...byId("orchestrator"), effort: "high" as const, model: "opus" }
    const made = templateArgv({ dispatcher: "dispatcher", name: "x", root: ROOT, template })
    expect("steps" in made && made.steps[1]!.slice(4)).toEqual([
      "--model",
      "opus",
      "--effort",
      "high",
    ])
  })
})

describe("a template's brief", () => {
  test.each(["../secrets.md", "briefs/builder.md", "/etc/passwd", "a..md"])(
    "templateArgv refuses %s, so no path leaves the brief folders",
    (brief) => {
      const template = { ...byId("orchestrator"), brief }
      expect("error" in templateArgv({ dispatcher: "d", name: "x", root: ROOT, template })).toBe(
        true,
      )
    },
  )
})

describe("the account and the refusal a template reads", () => {
  test("secondAccount takes the first Claude row that is not this machine's login", () => {
    const rows = [
      { email: null, provider: "glm" },
      { email: "First@example.test", provider: "claude" },
      { email: "second@example.test", provider: "claude" },
    ]
    expect(secondAccount(rows, "first@example.test")).toBe("second@example.test")
    expect(secondAccount(rows.slice(0, 2), "first@example.test")).toBeUndefined()
  })

  test("refusalOf names the missing account, then a brief found nowhere", () => {
    const claude = byId("second-dispatcher-claude")
    expect(refusalOf(claude, { briefFound: true })).toBe(NEEDS_ACCOUNT)
    expect(refusalOf(claude, { account: "a@example.test", briefFound: true })).toBeNull()
    expect(refusalOf(byId("assistant"), { briefFound: false })).toContain("assistant.md")
  })
})

// The process boundary as a script: each argv recorded, the name picker answering a name, every other step the answer given.
const cli = (answer: { code: number; stderr?: string }) => {
  const calls: string[][] = []
  const run: Run = async (argv) => {
    calls.push(argv)
    if (argv[1]?.endsWith("name/index.ts"))
      return { code: 0, stderr: "", stdout: "c8m3nr-builder\n" }
    return { stderr: "", stdout: "", ...answer }
  }
  return { calls, run }
}

describe("startTemplate on a stack reading its own machine", () => {
  const root = mkdtempSync(join(scratch, "root-"))
  const data = mkdtempSync(join(scratch, "data-"))
  mkdirSync(join(root, "scripts/briefs"), { recursive: true })
  writeFileSync(join(root, "scripts/briefs/builder.md"), "the builder's brief\n")
  const start = (id: string, run: Run, isHeld = async () => false) =>
    startTemplate(id, { data, isHeld, live: true, login: null, root, run })

  test("an orchestrator gets its roster row, then spawn.sh, its brief filled from scripts/briefs", async () => {
    const { calls, run } = cli({ code: 0 })
    expect(await start("orchestrator", run)).toEqual({ name: "c8m3nr-builder", status: "started" })
    expect(calls.map((argv) => (argv[1] === "manager" ? argv[0] : argv[1]))).toEqual([
      `${root}/packages/scripts/src/name/index.ts`,
      `${root}/scripts/roster.ts`,
      `${root}/scripts/spawn.sh`,
    ])
    expect(readFileSync(join(data, "brief-c8m3nr-builder.md"), "utf8")).toBe(
      "the builder's brief\n",
    )
  })

  test("spawn.sh's refusal comes back as its last line, whole", async () => {
    const reason = `spawn.sh refuses c8m3nr-builder: the capacity gate reads 9 of 8 ${"x".repeat(300)}`
    const answer = await start(
      "orchestrator",
      cli({ code: 1, stderr: `checking\n${reason}\n` }).run,
    )
    expect(answer).toEqual({ detail: reason, name: "c8m3nr-builder", status: "refused" })
    expect((await start("orchestrator", cli({ code: 2 }).run)).status).toBe("failed")
  })

  test("a held name answers running and runs no step past the name picker", async () => {
    const { calls, run } = cli({ code: 0 })
    expect(await start("orchestrator", run, async () => true)).toEqual({
      name: "c8m3nr-builder",
      status: "running",
    })
    expect(calls).toHaveLength(1)
  })

  test("a gate's refusal runs nothing: a Claude second dispatcher with no second account, a brief found nowhere", async () => {
    const { calls, run } = cli({ code: 0 })
    expect(await start("second-dispatcher-claude", run)).toMatchObject({
      detail: NEEDS_ACCOUNT,
      status: "refused",
    })
    expect(await start("assistant", run)).toMatchObject({ status: "refused" })
    expect(calls).toEqual([])
    expect(existsSync(join(data, "brief-dispatcher-2.md"))).toBe(false)
  })

  test("an id no template has is missing", async () => {
    expect(await start("nope", cli({ code: 0 }).run)).toEqual({ status: "missing" })
  })
})
