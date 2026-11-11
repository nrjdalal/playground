import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { WAITER } from "../../../scripts/hooks/after-compact"
import { check, lastEntry, rearm } from "../../../scripts/hooks/after-resume"

const input = JSON.stringify({
  hook_event_name: "SessionStart",
  session_id: "s-1",
  source: "resume",
})

const now = new Date("2026-10-25T21:58:50Z")

// A resumed transcript as measured on 2.1.309: entries out of time order, untimestamped records after the last turn, a message whose text quotes a timestamp, and a tool result carrying one of its own after now.
const transcript = () => {
  const path = join(mkdtempSync(join(tmpdir(), "after-resume-")), "s-1.jsonl")
  const lines = [
    { timestamp: "2026-10-25T21:42:12.731Z", type: "api-request" },
    { timestamp: "2026-10-25T21:42:12.676Z", type: "user" },
    {
      message: { content: '{"timestamp":"2026-10-25T21:50:00.000Z"}' },
      timestamp: "2026-10-25T21:42:13.300Z",
      type: "assistant",
    },
    { timestamp: "2026-10-25T21:42:13.304Z", type: "system" },
    {
      timestamp: "2026-10-25T21:42:13.100Z",
      toolUseResult: { timestamp: "2026-10-30T00:00:00.000Z" },
      type: "user",
    },
    { type: "last-prompt" },
    { type: "cost-state" },
  ]
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`)
  return path
}

describe("after a restart, a resumed factory session re-arms its watches and re-sends unanswered asks", () => {
  test.each(["dispatcher", "lead", "worker", "reviewer", "tester", "runner", "probe"])(
    "a %s gets the instruction as SessionStart context, a manager's with its alerts-wait line",
    async (role) => {
      const out = await check(input, { PLAYGROUND_ROLE: role }, now)
      const manager = role === "dispatcher" || role === "lead"
      expect(JSON.parse(out ?? "null")).toEqual({
        hookSpecificOutput: {
          additionalContext: manager ? `${rearm(undefined, now)} ${WAITER}` : rearm(undefined, now),
          hookEventName: "SessionStart",
        },
      })
    },
  )

  test("the 10 minutes end at the transcript's last entry before the restart, however long the session stayed down", async () => {
    const raw = JSON.stringify({ ...JSON.parse(input), transcript_path: transcript() })
    const out = JSON.parse((await check(raw, { PLAYGROUND_ROLE: "worker" }, now)) ?? "null")
    const text: string = out.hookSpecificOutput.additionalContext
    expect(text).toContain("resumed at 2026-10-25T21:58Z")
    expect(text).toContain(
      "10 minutes before 2026-10-25T21:42Z, your last entry before the restart",
    )
  })

  test("the last entry is the newest real timestamp, never one quoted inside a message nor one after now", async () => {
    expect(await lastEntry(transcript(), now)).toEqual(new Date("2026-10-25T21:42:13.304Z"))
  })

  test("with no transcript to read, the 10 minutes end at the resume", async () => {
    expect(await lastEntry(undefined)).toBeUndefined()
    const raw = JSON.stringify({
      ...JSON.parse(input),
      transcript_path: "/nonexistent-dir-for-test/s-1.jsonl",
    })
    const out = JSON.parse((await check(raw, { PLAYGROUND_ROLE: "worker" }, now)) ?? "null")
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "10 minutes before 2026-10-25T21:58Z, the resume",
    )
  })

  describe("the edit lefthook set aside when a restart killed a commit", () => {
    const git = (cwd: string, ...args: string[]) => {
      const run = Bun.spawnSync(
        ["git", "-c", "user.email=t@example.com", "-c", "user.name=t", ...args],
        { cwd },
      )
      if (run.exitCode !== 0) throw new Error(run.stderr.toString())
    }
    // A main checkout and a worktree whose folder is not its branch's name, since lefthook names its patch by the worktree's folder.
    const scratch = () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "after-resume-git-")))
      const main = join(root, "main")
      mkdirSync(main)
      git(main, "init", "-q", "-b", "canary")
      git(main, "commit", "-q", "--allow-empty", "-m", "init")
      git(main, "worktree", "add", "-q", join(root, "wt-folder"), "-b", "PG-9-slug")
      const info = join(main, ".git", "info")
      mkdirSync(info, { recursive: true })
      return { info, main, worktree: join(root, "wt-folder") }
    }
    const resumedIn = async (cwd: string) => {
      const raw = JSON.stringify({ ...JSON.parse(input), cwd })
      const out = JSON.parse((await check(raw, { PLAYGROUND_ROLE: "worker" }, now)) ?? "null")
      return out.hookSpecificOutput.additionalContext as string
    }
    const patch = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -3 +3 @@ b\n-c\n+c2\n"

    test("a worktree's patch left behind is named, with the command that puts it back before any commit", async () => {
      const { info, worktree } = scratch()
      const left = join(info, "lefthook-unstaged.wt-folder.patch")
      writeFileSync(left, patch)
      const text = await resumedIn(worktree)
      expect(text).toContain(`git apply --unidiff-zero ${left}`)
      expect(text).toContain("before any commit")
    })

    test("a main checkout's patch has no worktree name", async () => {
      const { info, main } = scratch()
      const left = join(info, "lefthook-unstaged.patch")
      writeFileSync(left, patch)
      expect(await resumedIn(main)).toContain(`git apply --unidiff-zero ${left}`)
    })

    test("with no patch left behind, it says nothing of one", async () => {
      expect(await resumedIn(scratch().worktree)).not.toContain("lefthook")
    })

    test("another worktree's patch is not this session's to restore", async () => {
      const { info, worktree } = scratch()
      writeFileSync(join(info, "lefthook-unstaged.other-folder.patch"), patch)
      writeFileSync(join(info, "lefthook-unstaged-all.wt-folder.patch"), patch)
      expect(await resumedIn(worktree)).not.toContain("lefthook")
    })
  })

  test("a session outside the factory, the owner's own, gets nothing", async () => {
    expect(await check(input, {}, now)).toBeUndefined()
  })

  test("input that does not read, or a registry that cannot be read, fails open to nothing", async () => {
    expect(await check("not json", {}, now)).toBeUndefined()
    expect(
      await check(input, { CLAUDE_CONFIG_DIR: "/nonexistent-dir-for-test" }, now),
    ).toBeUndefined()
  })
})
