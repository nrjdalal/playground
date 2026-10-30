import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { gatesOf, type PrFacts } from "../../../../../packages/scripts/src/pr-merge/gates"
import {
  carried,
  JOB_CHECKS,
  jobsStamp,
  readsOf,
  readStamp,
  stampAt,
  stampOf,
  stampsAt,
  stampText,
  suitePassed,
  walk,
  type CheckRun,
  type Exec,
  type Reads,
  type Stamp,
  type StampKeys,
} from "../../../../../packages/scripts/src/pr-merge/stamp"
import "./scratch-config"
import { SUITE, suiteChecks } from "./suite"

const HEAD = "69a6a4c5e6caf46c4abda6a89de4ce6f3b309e88"
const OLD = "5740ceaa347f9c0f4e5a2f109f433e7838468b1f"
const OWN = "0d1e2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a"
const CANARY = "6f3db1ea4cb7ea4072e0d5454da0026c89635cab"
const NEXT = "7a8b9c0d1e2f3a4b5c6d7e8f9012345678901234"

let clock = 0
const at = () => new Date(Date.UTC(2026, 9, 27, 16, 0, clock++)).toISOString()

// A stamp as the parser gives it: the readers take the object, never the text.
const stamp = (sha: string, patch: Partial<StampKeys> = {}): Stamp => ({
  at: sha.slice(0, 7),
  checks: { test: { source: "local", status: "pass" } },
  commit: sha.slice(0, 7),
  createdAt: at(),
  status: "green",
  ...patch,
})

const look = (sha: string, status: "green" | "red" | "wait" = "green") =>
  stamp(sha, {
    checks: { "agent-review": { source: "agent", status: "pass" } },
    status,
  })

// A branch as the walk reads it: each commit's parents, and which merges are clean canary merges.
const reads = (parents: Record<string, string[]>, clean: string[] = []): Reads => ({
  clean: async (sha) => clean.includes(sha),
  onCanary: async (sha) => sha === CANARY || sha === NEXT,
  parents: async (sha) => parents[sha] ?? [],
})

const read = async (parents: Record<string, string[]>, stamps: Stamp[], clean: string[] = []) =>
  readStamp(await walk(HEAD, stamps, reads(parents, clean)))

describe("stampOf and stampsAt", () => {
  const said = (keys: StampKeys, author = "acme") => ({
    author,
    body: stampText(keys),
    createdAt: at(),
  })

  test("takes the owner's stamp as its keys, and refuses anyone else's", () => {
    const { at: _, createdAt: __, ...keys } = stamp(HEAD)
    expect(stampOf(said(keys), "ACME")).toMatchObject({ ...keys, at: "69a6a4c" })
    expect(stampOf(said(keys, "someone-else"), "acme")).toBeNull()
    expect(stampOf({ author: "acme", body: "Looks good.", createdAt: at() }, "acme")).toBe(null)
  })

  test("the newest stamp from each place holds, and a tester's stands apart from the reviewer's look", () => {
    const red = stamp(HEAD, { status: "red" })
    const green = stamp(HEAD)
    const drive = stamp(HEAD, { checks: { "agent-drive": { source: "agent", status: "pass" } } })
    const ci = stamp(HEAD, { checks: { test: { source: "1823", status: "pass" } } })
    const held = stampsAt([red, ci, drive, green, stamp(OLD)], HEAD)
    expect(held).toEqual([ci, drive, green])
    const looked = look(HEAD)
    expect(stampsAt([drive, looked], HEAD)).toEqual([looked, drive])
  })

  test("a review wait gives way to a CI stamp written after it", () => {
    const wait = look(HEAD, "wait")
    expect(stampsAt([wait], HEAD)).toEqual([wait])
    const red = look(HEAD, "red")
    const ran = stamp(HEAD, { checks: { test: { source: "1823", status: "pass" } } })
    expect(stampsAt([wait, ran], HEAD)).toEqual([ran])
    // a red look stands over a CI stamp written after it
    expect(stampsAt([red, ran], HEAD)).toEqual([ran, red])
  })
})

describe("the walk", () => {
  test("a stamp on the head holds, with the checks it passed", async () => {
    const got = await read({ [HEAD]: [OWN] }, [stamp(HEAD)])
    expect(got).toMatchObject({ at: HEAD, passed: ["test"], reach: [HEAD], status: "green" })
  })

  test("clean canary merges carry the stamp, whatever files the two sides share", async () => {
    // The walk asks git whether the merge is clean, never which files it holds, so a bun.lock both sides changed carries too.
    const parents = { [HEAD]: [OLD, NEXT], [OLD]: [OWN, CANARY], [OWN]: [CANARY] }
    const got = await read(parents, [stamp(OWN)], [HEAD, OLD])
    expect(got).toMatchObject({ at: OWN, reach: [HEAD, OLD, OWN], status: "green" })
  })

  test("a merge that is not clean, with no review stamp, is refused", async () => {
    const got = await read({ [HEAD]: [OWN, CANARY] }, [stamp(OWN)])
    expect(got.status).toBeUndefined()
    expect(got.why).toContain("69a6a4c has no stamp and is no clean canary merge")
    expect(gatesOf(facts({ stamp: got })).find((g) => g.name === "stamp")?.ok).toBe(false)
  })

  test("a review green on that merge is accepted, and a review wait refused", async () => {
    const parents = { [HEAD]: [OWN, CANARY], [OWN]: [CANARY] }
    const green = await read(parents, [stamp(OWN), look(HEAD)])
    expect(green).toMatchObject({ at: OWN, passed: ["agent-review", "test"], status: "green" })
    expect(green.reach).toEqual([HEAD, OWN])
    const wait = await read(parents, [stamp(OWN), look(HEAD, "wait")])
    expect(wait.status).toBe("wait")
    expect(gatesOf(facts({ stamp: wait })).find((g) => g.name === "stamp")?.ok).toBe(false)
  })

  test("a tester's green drive beside the look still carries, and a red or waiting one stops it", async () => {
    const parents = { [HEAD]: [OWN, CANARY], [OWN]: [CANARY] }
    const drive = (status: "green" | "red" | "wait" = "green") =>
      stamp(HEAD, { checks: { "agent-drive": { source: "agent", status: "pass" } }, status })
    const both = await read(parents, [stamp(OWN), look(HEAD), drive()])
    expect(both).toMatchObject({ at: OWN, reach: [HEAD, OWN], status: "green" })
    expect(both.passed).toEqual(expect.arrayContaining(["agent-drive", "agent-review", "test"]))
    expect((await read(parents, [stamp(OWN), look(HEAD), drive("red")])).status).toBe("red")
    expect((await read(parents, [stamp(OWN), look(HEAD), drive("wait")])).status).toBe("wait")
    // a run's own stamp on the merge is a run there, so the look does not carry past it
    const ran = await read(parents, [stamp(OWN), look(HEAD), stamp(HEAD)])
    expect(ran).toMatchObject({ at: HEAD, reach: [HEAD] })
  })

  test("a review green carries what lies under it: a red stays red, and no run's stamp reads as none", async () => {
    const parents = { [HEAD]: [OWN, CANARY], [OWN]: [CANARY] }
    const red = await read(parents, [stamp(OWN, { status: "red" }), look(HEAD)])
    expect(red).toMatchObject({ at: OWN, status: "red" })
    expect(gatesOf(facts({ stamp: red })).find((g) => g.name === "stamp")?.ok).toBe(false)
    const bare = await read(parents, [look(HEAD)])
    expect(bare.status).toBeUndefined()
    expect(bare.why).toContain("0d1e2f3 has no stamp")
    const only = await read({}, [look(HEAD)])
    expect(only.status).toBeUndefined()
    expect(only.why).toContain("69a6a4c has no stamp")
  })

  test("a look on a commit that is no canary merge carries nothing: the walk stops there with no stamp", async () => {
    // HEAD is a commit of the PR's own over OWN, which ran the suite; a review green on HEAD must not carry OWN's stamp or its 5/5
    const parents = { [HEAD]: [OWN], [OWN]: [CANARY] }
    const got = await read(parents, [stamp(OWN), look(HEAD)])
    expect(got.status).toBeUndefined()
    expect(got.reach).toEqual([HEAD])
    expect(got.why).toContain("69a6a4c has no stamp")
    expect(gatesOf(facts({ stamp: got })).find((g) => g.name === "stamp")?.ok).toBe(false)
  })

  test("red, and a commit of the PR's own with no stamp, are not ready", async () => {
    expect((await read({ [HEAD]: [OWN] }, [stamp(HEAD, { status: "red" })])).status).toBe("red")
    const bare = await read({ [HEAD]: [OWN] }, [stamp(OWN)])
    expect(bare).toMatchObject({ passed: [], stamps: [] })
    expect(bare.status).toBeUndefined()
  })

  test("the nearest stamp naming a check decides it, past clean merges and review greens", async () => {
    const parents = { [HEAD]: [OLD, CANARY], [OLD]: [OWN, NEXT], [OWN]: [CANARY] }
    const verify = { source: "local", status: "pass" as const }
    const got = await read(parents, [stamp(OWN, { checks: { verify } }), look(OLD)], [HEAD])
    expect(got).toMatchObject({ at: OWN, passed: ["agent-review", "verify"], status: "green" })
    const failed = {
      comment: "The browser check failed.",
      source: "local",
      status: "fail" as const,
    }
    const red = [stamp(OWN, { checks: { verify } }), stamp(OLD, { checks: { verify: failed } })]
    expect((await read(parents, red, [HEAD])).passed).toEqual([])
  })
})

describe("readsOf on a real repository", () => {
  const git =
    (cwd: string): Exec =>
    async (args) => {
      const proc = Bun.spawn(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" })
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      return { code, stderr, stdout }
    }

  test("a merge of canary that touches the same bun.lock is clean; a hand edit in the merge is not", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stamp-walk-"))
    try {
      const run = git(dir)
      const sh = async (...args: string[]) => {
        const done = await run(args)
        if (done.code !== 0) throw new Error(done.stderr)
        return done.stdout.trim()
      }
      const lock = (lines: string[]) => Bun.write(join(dir, "bun.lock"), `${lines.join("\n")}\n`)
      const base = ["a", "b", "c", "d", "e", "f", "g"]
      await sh("init", "-q", "-b", "canary")
      await sh("config", "user.email", "t@t")
      await sh("config", "user.name", "t")
      await lock(base)
      await sh("add", ".")
      await sh("commit", "-qm", "base")
      await sh("checkout", "-qb", "pr")
      await lock(["A", ...base.slice(1)])
      await sh("commit", "-qam", "pr")
      await sh("checkout", "-q", "canary")
      await lock([...base.slice(0, 6), "G"])
      await sh("commit", "-qam", "canary")
      await sh("update-ref", "refs/remotes/origin/canary", "canary")
      await sh("checkout", "-q", "pr")
      await sh("merge", "-q", "--no-edit", "canary")
      const clean = await sh("rev-parse", "HEAD")
      await lock(["A", ...base.slice(1, 6), "G", "hand"])
      await sh("add", ".")
      await sh("commit", "-q", "--amend", "--no-edit")
      const edited = await sh("rev-parse", "HEAD")
      const reads = readsOf(run)
      expect(await reads.clean(clean)).toBe(true)
      expect(await reads.clean(edited)).toBe(false)
      expect(await reads.onCanary(await sh("rev-parse", "canary"))).toBe(true)
      const pr = await sh("rev-parse", `${clean}^1`)
      const read = await stampAt(
        clean,
        [{ author: "acme", body: stampText(stamp(pr)), createdAt: at() }],
        "acme",
        reads,
      )
      expect(read).toMatchObject({ at: pr, status: "green" })
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})

const facts = (patch: Partial<PrFacts> = {}): PrFacts => ({
  aheadBy: 0,
  author: "acme",
  base: "canary",
  canary: CANARY,
  checks: [],
  comments: [
    {
      author: "acme",
      body: `## ReviewBot · round 1: 5/5 at ${HEAD.slice(0, 7)}`,
      createdAt: at(),
    },
  ],
  draft: false,
  files: ["packages/scripts/src/pr-merge/gates.ts"],
  head: HEAD,
  held: null,
  lost: [],
  mergeTree: CANARY,
  n: 7,
  owner: "acme",
  stamp: {
    at: HEAD,
    passed: SUITE,
    reach: [HEAD],
    stamps: [stamp(HEAD)],
    status: "green",
    why: "",
  },
  state: "OPEN",
  ...patch,
})

const failing = (patch: Partial<PrFacts>) =>
  gatesOf(facts(patch))
    .filter((gate) => !gate.ok)
    .map((gate) => gate.name)

describe("merging several at once", () => {
  test("two stamped PRs that share no files merge back to back with no new run", () => {
    // The first lands; the second is now one commit behind canary, which merges in clean, so its stamp carries.
    expect(failing({ files: ["skills/a.md"] })).toEqual([])
    expect(failing({ aheadBy: 1, files: ["skills/b.md"] })).toEqual([])
  })

  test("a PR that conflicts with canary waits for its merge and the reviewer's look", () => {
    expect(failing({ aheadBy: 1, mergeTree: null })).toEqual(["up to date"])
  })

  test("two PRs that each pass alone but push a size-capped file over are caught by canary's own run", () => {
    // Each grows playbook's SKILL.md under core.test's cut, so each stamp is green and each merges.
    const first = facts({ files: ["extensions/core/skills/playbook/SKILL.md"] })
    expect(gatesOf(first).every((gate) => gate.ok)).toBe(true)
    expect(failing({ aheadBy: 1, files: first.files })).toEqual([])
    // Together they cross it: canary's run after the batch stamps its tip red, and the next merge waits.
    const red = stamp(CANARY, {
      checks: {
        "test:skills": {
          comment: "The SKILL.md size test failed.",
          source: "local",
          status: "fail",
        },
      },
      status: "red",
    })
    expect(failing({ canaryStamps: [red], files: ["skills/c.md"] })).toEqual(["canary"])
  })

  test("a red canary stops the queue until a green run on its tip", () => {
    const red = stamp(CANARY, { status: "red" })
    expect(failing({ canaryStamps: [red] })).toEqual(["canary"])
    expect(failing({ canaryStamps: stampsAt([red, stamp(CANARY)], CANARY) })).toEqual([])
  })
})

describe("jobsStamp", () => {
  const job = (name: string, conclusion: string | null, status = "completed"): CheckRun => ({
    conclusion,
    html_url: `https://github.com/acme/factory/actions/runs/1823/job/${name.length}`,
    name,
    started_at: at(),
    status,
  })
  const both = (lint: string | null, skills: string | null, status = "completed") => [
    job("Audit, Lint, and Build", lint, status),
    job("test", skills, status),
  ]

  test("stamps green once both jobs passed, and red when one failed", () => {
    const green = jobsStamp(undefined, HEAD, both("success", "success"))
    expect(green).toContain("status: green")
    expect(green).toContain("  check-types:\n    status: pass\n    source: 1823")
    const red = jobsStamp(undefined, HEAD, both("success", "failure")) ?? ""
    expect(red).toContain("status: red")
    expect(red).toContain(
      "  test:skills:\n    status: fail\n    source: 1823\n    comment: The test job ended failure.",
    )
    expect(red).toContain("\nremark: The test job failed.")
  })

  test("stamps wait while a job is queued or running, or was cancelled, since a cancelled job is no failure (#2420)", () => {
    const running = jobsStamp(undefined, HEAD, both(null, null, "in_progress")) ?? ""
    expect(running).toContain("status: wait")
    expect(running).toContain(
      "  test:skills:\n    status: skip\n    source: 1823\n    comment: The test job is in progress.",
    )
    expect(jobsStamp(undefined, HEAD, both(null, null, "queued"))).toContain("status: wait")
    const cancelled = jobsStamp(undefined, HEAD, both("success", "cancelled")) ?? ""
    expect(cancelled).toContain("status: wait")
    expect(cancelled).toContain("    comment: The test job ended cancelled.")
    expect(cancelled).not.toContain("remark:")
    // a failed job is red at once, while the other still runs
    expect(
      jobsStamp(undefined, HEAD, [
        job("Audit, Lint, and Build", null, "in_progress"),
        job("test", "failure"),
      ]),
    ).toContain("status: red")
    // a wait it already posted at the head is not posted again
    const waiting = stamp(HEAD, {
      checks: { test: { source: "1823", status: "skip" } },
      status: "wait",
    })
    const held = {
      at: HEAD,
      passed: [],
      reach: [HEAD],
      stamps: [waiting],
      status: "wait" as const,
      why: "",
    }
    expect(jobsStamp(held, HEAD, both(null, null, "in_progress"))).toBeNull()
    expect(jobsStamp(held, HEAD, both("success", "success"))).toContain("status: green")
  })

  test("skips verify, with its comment, when the diff has no dashboard code", () => {
    const plain = jobsStamp(undefined, HEAD, both("success", "success"), [], false) ?? ""
    expect(plain).toContain(
      "  verify:\n    status: skip\n    source: 1823\n    comment: The diff has no dashboard code.",
    )
    expect(jobsStamp(undefined, HEAD, both("success", "success"))).not.toContain("verify")
  })

  test("writes nothing while a job has no run or was skipped, once a green stamp carries, or when it already said it", () => {
    expect(jobsStamp(undefined, HEAD, both("skipped", "skipped"))).toBeNull()
    expect(jobsStamp(undefined, HEAD, [job("test", "success")])).toBeNull()
    const carried = {
      at: OWN,
      passed: Object.values(JOB_CHECKS).flat(),
      reach: [HEAD, OWN],
      stamps: [stamp(OWN)],
      status: "green" as const,
      why: "",
    }
    expect(jobsStamp(carried, HEAD, both("success", "success"))).toBeNull()
    // while canary's tip is red, a carried green skips nothing: the fix runs on its own head and is stamped there
    const red = [stamp(CANARY, { status: "red" })]
    expect(suitePassed(carried)).toBe(true)
    expect(suitePassed(carried, red)).toBe(false)
    expect(suitePassed(carried, [stamp(CANARY)])).toBe(true)
    expect(jobsStamp(carried, HEAD, both("success", "success"), red)).toContain("status: green")
    // a green from Checks alone ran no suite, so the jobs run and stamp
    const verified = { ...carried, passed: ["verify"] }
    expect(jobsStamp(verified, HEAD, both("success", "success"))).toContain("status: green")
    const said = stamp(HEAD, { checks: { test: { source: "1823", status: "pass" } } })
    const held = {
      at: HEAD,
      passed: [],
      reach: [HEAD],
      stamps: [said],
      status: "green" as const,
      why: "",
    }
    expect(jobsStamp(held, HEAD, both("success", "success"))).toBeNull()
    expect(jobsStamp(held, HEAD, both("failure", "success"))).toContain("status: red")
  })
  test("a job that ended in success with its steps skipped by a carry ran nothing, so it is stamped by no one", () => {
    const skipped = both("success", "success").map((run) => ({ ...run, skippedSteps: true }))
    expect(jobsStamp(undefined, HEAD, skipped)).toBeNull()
  })
})

describe("the workflows' skip (#2410)", () => {
  const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..")
  const head = (stamps: Stamp[], passed: string[]) => ({
    at: HEAD,
    passed,
    reach: [HEAD],
    stamps,
    status: "green" as const,
    why: "",
  })

  test("carried prints green only for a stamp that passed every check the jobs run, and never while canary is red", () => {
    const ran = head([stamp(HEAD, { checks: suiteChecks() })], SUITE)
    expect(carried(ran, [])).toMatchObject({ green: true })
    expect(carried(ran, [stamp(CANARY, { status: "red" })])).toMatchObject({ green: false })
    expect(carried(head([stamp(HEAD)], ["verify"]), [])).toMatchObject({ green: false })
    expect(carried("the parents of 69a6a4c did not read", [])).toEqual({
      green: false,
      why: "no stamp read: the parents of 69a6a4c did not read",
    })
  })

  test("the gate's workflows name their jobs as JOB_CHECKS does, so the stamp finds each", async () => {
    const names: string[] = []
    for (const file of ["hosted-check-build.yml", "hosted-test.yml"]) {
      const text = await Bun.file(join(ROOT, ".github", "workflows", file)).text()
      const { jobs } = Bun.YAML.parse(text) as { jobs: Record<string, { name?: string }> }
      names.push(...Object.entries(jobs).map(([id, job]) => job.name ?? id))
    }
    expect(names.toSorted()).toEqual(Object.keys(JOB_CHECKS).toSorted())
  })

  test.each([".github/workflows/hosted-check-build.yml", ".github/workflows/hosted-test.yml"])(
    "%s reads the stamp first and skips every later step on green=true",
    async (file) => {
      const text = await Bun.file(join(ROOT, file)).text()
      const steps = text.split(/\n\s+- name: /).slice(1)
      const first = steps.findIndex((step) => step.startsWith("Read the stamp"))
      expect(steps[first]).toContain("stamp-cli.ts carried")
      expect(steps[first]).toContain('|| echo "green=false" >> "$GITHUB_OUTPUT"')
      for (const step of steps.slice(first + 1))
        expect(step).toContain("if: steps.stamp.outputs.green != 'true'")
    },
  )
})
