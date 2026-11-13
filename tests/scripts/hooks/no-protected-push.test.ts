import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { originRepo } from "../../../packages/scripts/src/playground/setting"
import { check } from "../../../scripts/hooks/no-protected-push"
import { storeWith } from "./render-set"
import { git } from "./scratch-git"

// Made-up repositories: made-up/app is the factory's, by factory.repo; made-up/other is any other.
const APP = "https://github.com/made-up/app.git"
const OTHER = "https://github.com/made-up/other.git"
const dirs: Record<string, string> = {}
let scratch = ""
let data = ""

const ok = (dir: string, ...args: string[]) => {
  const run = git(dir, ...args)
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`)
}

async function clone(name: string, branch: string, ...remotes: [string, string][]) {
  const dir = join(scratch, name)
  await mkdir(dir, { recursive: true })
  ok(dir, "init", "-q", "-b", branch)
  ok(dir, "commit", "-q", "--allow-empty", "-m", "first")
  for (const [remote, url] of remotes) ok(dir, "remote", "add", remote, url)
  return dir
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "no-protected-push-"))
  data = storeWith(join(scratch, "data"), {}, { "factory.repo": "made-up/app" })
  dirs.app = await clone("app", "work", ["origin", APP], ["fork", OTHER])
  dirs.canary = await clone("on-canary", "canary", ["origin", APP])
  dirs.tracks = await clone("tracks", "work", ["origin", APP])
  ok(dirs.tracks, "config", "branch.work.remote", "origin")
  ok(dirs.tracks, "config", "branch.work.merge", "refs/heads/canary")
  dirs.refspec = await clone("refspec", "work", ["origin", APP])
  ok(dirs.refspec, "config", "remote.origin.push", "refs/heads/work:refs/heads/main")
  dirs.matching = await clone("matching", "work", ["origin", APP])
  ok(dirs.matching, "config", "push.default", "matching")
  dirs.alias = await clone("alias", "work", ["origin", APP])
  ok(dirs.alias, "config", "alias.p", "push")
  ok(dirs.alias, "config", "alias.s", "status")
  dirs.instead = await clone("instead", "work", ["origin", OTHER])
  ok(dirs.instead, "config", `url.${APP}.pushInsteadOf`, "https://example.com/x")
  dirs.pushurl = await clone("pushurl", "work", ["origin", OTHER])
  ok(dirs.pushurl, "remote", "set-url", "--push", "origin", APP)
  dirs.other = await clone("other", "canary", ["origin", OTHER])
  dirs.ext = await clone("ext", "work", [
    "origin",
    "https://github.com/made-up/playground-notes.git",
  ])
})

afterAll(async () => {
  await rm(scratch, { force: true, recursive: true })
})

const input = (command: string, cwd: string) =>
  JSON.stringify({ cwd, hook_event_name: "PreToolUse", tool_input: { command }, tool_name: "Bash" })
const bash = (command: string, cwd = dirs.app, environment: Record<string, string> = {}) =>
  check(input(command, cwd), { PLAYGROUND_DATA_DIR: data, ...environment })

describe("a push that writes main or canary of the factory's repository is refused", () => {
  test.each([
    ["main by name", "git push origin main"],
    ["canary by name", "git push origin canary"],
    ["main in capitals", "git push origin Main"],
    ["HEAD onto canary", "git push origin HEAD:canary"],
    ["a full ref", "git push origin work:refs/heads/main"],
    ["heads/ as the destination", "git push origin work:heads/canary"],
    ["a force push", "git push -f origin +work:main"],
    ["--force-with-lease", "git push --force-with-lease origin work:canary"],
    ["a delete", "git push origin --delete canary"],
    ["a delete by an empty source", "git push origin :main"],
    ["through run-slot", "~/.playground/ops/run-slot.sh w -- git push origin main"],
    ["through env", "env NODE_ENV=production SKIP_ENV_VALIDATION=true git push origin main"],
    ["through bash -c", "bash -c 'git push origin canary'"],
    ["one of several refspecs", "git push origin work main"],
    ["with -u", "git push -u origin HEAD:main"],
    ["to the factory's URL", `git push ${APP} main`],
  ])("%s", async (_, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-protected-push hook refuses this git push")
    expect(reason).toContain("pr:merge")
    expect(reason).toContain("ship:merge")
  })

  test("git -C from another folder", async () => {
    expect(await bash(`git -C ${dirs.app} push origin main`, dirs.other)).toContain(
      "writes main of made-up/app",
    )
  })

  test("cd into the checkout first", async () => {
    expect(await bash(`cd ${dirs.app} && git push origin canary`, dirs.other)).toContain(
      "writes canary",
    )
  })

  test("the factory's URL from another checkout", async () => {
    expect(await bash(`git push ${APP} HEAD:main`, dirs.other)).toContain("writes main")
  })

  test("a bare push with canary checked out", async () => {
    expect(await bash("git push", dirs.canary)).toContain("writes canary")
    expect(await bash("git push origin", dirs.canary)).toContain("writes canary")
    expect(await bash("git push origin HEAD", dirs.canary)).toContain("writes canary")
  })

  test("a bare push of a branch that tracks canary", async () => {
    expect(await bash("git push", dirs.tracks)).toContain("writes canary")
  })

  test("a push URL that is the factory's", async () => {
    expect(await bash("git push origin main", dirs.pushurl)).toContain("writes main")
  })
})

describe("a push the hook cannot read is refused where it may land in the factory's repository", () => {
  test.each([
    ["--all", "git push --all origin", "--all"],
    ["--mirror", "git push --mirror origin", "--mirror"],
    ["an abbreviated option", "git push --mir origin", "--mir"],
    ["--prune", "git push --prune origin 'refs/heads/*:refs/heads/*'", "--prune"],
    ["a glob", "git push origin 'refs/heads/*:refs/heads/*'", "many branches"],
    ["the matching refspec", "git push origin :", "many branches"],
    ["a ref built at run time", 'git push origin "$B"', "built at run time"],
    ["a remote built at run time", 'git push "$R" main', "built at run time"],
    ["HEAD after a checkout", "git checkout canary && git push", "may switch"],
    ["HEAD after a script", "bun run x && git push origin HEAD", "may switch"],
    ["-c on the push", "git -c push.default=matching push", "carries -c"],
    ["GIT_DIR", "GIT_DIR=/x/.git git push origin HEAD", "GIT_"],
    ["an inline alias", "git -c alias.p=push p origin main", "carries -c"],
    ["a subcommand built at run time", 'git "$S" origin main', "cannot read"],
    ["send-pack", "git send-pack origin main", "does not read"],
    ["subtree push", "git subtree push --prefix=x origin main", "does not read"],
    ["refs from xargs", "echo main | xargs git push origin", "xargs"],
  ])("%s", async (_, command, why) => {
    const reason = await bash(command)
    expect(reason).toContain("no-protected-push hook refuses this git push")
    expect(reason).toContain(why)
  })

  test("a configured alias in the alias checkout", async () => {
    expect(await bash("git p origin main", dirs.alias)).toContain("an alias that may push")
  })

  test("a push refspec in the config", async () => {
    expect(await bash("git push", dirs.refspec)).toContain("push refspec")
  })

  test("push.default matching", async () => {
    expect(await bash("git push", dirs.matching)).toContain("matching")
  })

  test("a pushInsteadOf rule that rewrites the remote", async () => {
    expect(await bash("git push https://example.com/x main", dirs.instead)).toContain(
      "pushInsteadOf",
    )
  })

  test("a folder the hook cannot read", async () => {
    expect(await bash('cd "$D" && git push origin main', dirs.other)).toContain("does not read")
  })

  test("factory.repo unset falls back to the main checkout's origin", async () => {
    const empty = join(scratch, "no-store")
    const fallback = await clone("fallback", "work", [
      "origin",
      `https://github.com/${originRepo()}.git`,
    ])
    expect(
      await check(input("git push origin main", fallback), { PLAYGROUND_DATA_DIR: empty }),
    ).toContain(`writes main of ${originRepo()}`)
  })
})

describe("every other push runs", () => {
  test.each([
    ["the work branch by name", "git push origin work"],
    ["HEAD onto the work branch", "git push origin HEAD:work"],
    ["HEAD with -u", "git push -u origin HEAD"],
    ["a bare push of the work branch", "git push"],
    ["a branch whose name holds main", "git push origin HEAD:main-fix"],
    ["a branch under a folder named canary", "git push origin HEAD:PG-1-canary/x"],
    ["tags alone", "git push --tags origin"],
    ["a tag named main", "git push origin work:refs/tags/main"],
    ["after a commit", "git add -A && git commit -m m && git push"],
    [
      "after a commit with a heredoc message",
      "git commit -m \"$(cat <<'EOF'\nfix\nEOF\n)\" && git push origin HEAD",
    ],
    ["a delete of the work branch", "git push origin --delete work"],
    ["main of another remote", "git push fork main"],
    ["a dry run of the work branch", "git push -n origin work"],
    ["a subcommand that is no alias", "git s"],
    ["echo", "echo git push origin main"],
    ["a commit message naming the push", "git commit -m 'git push origin main is refused'"],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test.each([
    ["main of another repository", "git push origin main", "other"],
    ["canary of another repository", "git push origin canary", "other"],
    ["a bare push in another repository on canary", "git push", "other"],
    ["main of an extension repository", "git push origin HEAD:main", "ext"],
  ])("%s", async (_, command, dir) => {
    expect(await bash(command, dirs[dir])).toBeUndefined()
  })

  test("a call that is not Bash runs", async () => {
    const raw = JSON.stringify({ tool_input: { file_path: "/x" }, tool_name: "Read" })
    expect(await check(raw, { PLAYGROUND_DATA_DIR: data })).toBeUndefined()
  })
})
