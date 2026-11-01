import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-extensions-write"

// A home whose data folder holds an extensions root, with a list, policy.json and a scope's sources, as a machine with extensions has.
const HOME = mkdtempSync(join(tmpdir(), "no-extensions-write-"))
const DATA = join(HOME, ".playground")
const ROOT = join(DATA, "extensions")
const LIST = join(ROOT, "hooks", "desktop-owner-apps.json")
const SCOPE = join(ROOT, "login")
mkdirSync(join(ROOT, "hooks"), { recursive: true })
mkdirSync(join(SCOPE, "lists"), { recursive: true })
mkdirSync(join(DATA, "handoffs"), { recursive: true })
writeFileSync(LIST, '["Slack"]\n')
writeFileSync(join(ROOT, "policy.json"), "{}\n")
writeFileSync(join(SCOPE, "lists", "release-owners.json"), "[]\n")
const LINK = join(HOME, "store")
symlinkSync(ROOT, LINK)
afterAll(() => rmSync(HOME, { force: true, recursive: true }))

const ENV = { HOME }

const bash = (command: string, cwd = HOME) =>
  check(
    JSON.stringify({
      cwd,
      hook_event_name: "PreToolUse",
      tool_input: { command },
      tool_name: "Bash",
    }),
    ENV,
  )

const tool = (tool_name: string, input: Record<string, unknown>) =>
  check(
    JSON.stringify({ cwd: HOME, hook_event_name: "PreToolUse", tool_input: input, tool_name }),
    ENV,
  )

describe("a direct write into the extensions root is refused, naming the owner's route", () => {
  test.each([
    ["Edit of a list", "Edit", { file_path: LIST, new_string: "[]", old_string: '["Slack"]' }],
    ["Write of a list", "Write", { content: "[]", file_path: LIST }],
    ["MultiEdit of policy.json", "MultiEdit", { edits: [], file_path: join(ROOT, "policy.json") }],
    ["NotebookEdit under the root", "NotebookEdit", { notebook_path: join(ROOT, "a.ipynb") }],
    [
      "Write of a scope's list source",
      "Write",
      { content: "[]", file_path: join(SCOPE, "lists", "release-owners.json") },
    ],
    [
      "Write through a link to the root",
      "Write",
      { content: "[]", file_path: join(LINK, "hooks", "a.json") },
    ],
    [
      "Write by a path relative to the cwd",
      "Write",
      { content: "[]", file_path: ".playground/extensions/policy.json" },
    ],
  ])("%s", async (_, name, input) => {
    const reason = await tool(name, input)
    expect(reason).toContain("no-extensions-write hook refuses")
    expect(reason).toContain("!")
  })

  test.each([
    ["a redirect", `echo '[]' > ${LIST}`],
    [
      "a redirect by $HOME",
      'echo [] > "$HOME/.playground/extensions/hooks/desktop-owner-apps.json"',
    ],
    ["an appending redirect", `echo x >> ${join(ROOT, "policy.json")}`],
    ["a redirect through a link", `echo '[]' > ${join(LINK, "hooks", "a.json")}`],
    ["cp onto a list", `cp /tmp/empty.json ${LIST}`],
    ["cp out of the root", `cp ${LIST} /tmp/copy.json`],
    ["mv a list away", `mv ${LIST} /tmp/x.json`],
    ["rm of a list", `rm ${LIST}`],
    ["rm -rf of the root", `rm -rf ${ROOT}`],
    ["rm -rf of the data folder above it", `rm -rf ${DATA}`],
    ["find -delete above it", `find ${DATA} -name '*.json' -delete`],
    ["a relative path after a cd into the data folder", `cd ${DATA} && rm -rf extensions`],
    ["mv of the data folder above it", `mv ${DATA} /tmp/old-data`],
    ["rsync above it", `rsync -a --delete /tmp/empty/ ${DATA}/`],
    ["sed -i of a list", `sed -i '' 's/Slack//' ${LIST}`],
    ["tee into a list", `echo [] | tee ${LIST}`],
    ["touch under the root", `touch ${join(ROOT, "hooks", "new.json")}`],
    ["ln into the root", `ln -sf /tmp/x ${LIST}`],
    ["chmod of the root", `chmod -R u+w ${ROOT}`],
    ["dd of= a list", `dd if=/dev/null of=${LIST}`],
    ["bun -e naming the root", `bun -e 'await Bun.write("${LIST}", "[]")'`],
    [
      "python3 -c naming the root by ~",
      `python3 -c 'open("/x/.playground/extensions/hooks/a.json","w")'`,
    ],
    [
      "a heredoc to an interpreter naming the root",
      `python3 - <<'EOF'\nopen("${LIST}", "w").write("[]")\nEOF`,
    ],
    ["a cd into a scope, then git commit", `cd ${SCOPE} && git commit -am x`],
    [
      "a cd into the root, then a relative write by an interpreter",
      `cd ${ROOT} && node -e 'require("fs").writeFileSync("policy.json","{}")'`,
    ],
    ["git -C a scope reset", `git -C ${SCOPE} reset --hard HEAD~1`],
    ["git -C a scope checkout", `git -C ${SCOPE} checkout HEAD~1 -- lists`],
    ["git diff --output into the root", `git diff --output=${LIST}`],
    ["through run-slot", `~/.playground/ops/run-slot.sh w -- rm ${LIST}`],
    ["through bash -c", `bash -c "rm ${LIST}"`],
    ["through env", `env FOO=1 rm ${LIST}`],
  ])("%s", async (_, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-extensions-write hook refuses")
  })

  test("a Bash call whose cwd is already inside the root runs no writer", async () => {
    expect(await bash("node -e 'x'", SCOPE)).toContain("no-extensions-write hook refuses")
  })
})

// The shell reads ~ as the process's home, so these rows judge the real home's root, which the hook only reads.
describe("a write by ~ is judged against the home the shell expands it to", () => {
  const real = { HOME: homedir() }
  test.each([
    ["a redirect by ~", "echo '[]' > ~/.playground/extensions/hooks/desktop-owner-apps.json"],
    ["rm -rf of the root by ~", "rm -rf ~/.playground/extensions"],
    ["rm -rf of the data folder by ~", "rm -rf ~/.playground"],
    ["a cd by ~, then a relative rm", "cd ~ && rm -rf .playground/extensions"],
  ])("%s", async (_, command) => {
    const reason = await check(
      JSON.stringify({ cwd: tmpdir(), tool_input: { command }, tool_name: "Bash" }),
      real,
    )
    expect(reason).toContain("no-extensions-write hook refuses")
  })

  test("ls by ~ runs", async () => {
    const raw = JSON.stringify({
      cwd: tmpdir(),
      tool_input: { command: "ls ~/.playground/extensions/hooks" },
      tool_name: "Bash",
    })
    expect(await check(raw, real)).toBeUndefined()
  })
})

describe("a read of the root, and writes elsewhere, run", () => {
  test.each([
    ["cat of a list", `cat ${LIST}`],
    ["jq of policy.json", `jq . ${join(ROOT, "policy.json")}`],
    ["ls of the root by ~", "ls -la ~/.playground/extensions ~/.playground/extensions/hooks"],
    ["grep in the root", `grep -rn Slack ${ROOT}`],
    ["head and wc", `head -5 ${LIST} && wc -l ${LIST}`],
    ["find without an action", `find ${ROOT} -name '*.json'`],
    ["git log in a scope", `git -C ${SCOPE} log --oneline -5`],
    ["git show in a scope", `cd ${SCOPE} && git show HEAD --stat`],
    ["git status in a scope", `git -C ${SCOPE} status`],
    ["a list read into a file elsewhere", `cat ${LIST} > /tmp/copy.json`],
    ["a handoff in the data folder", `echo next > ${join(DATA, "handoffs", "w.md")}`],
    ["the roster's writer", "bun scripts/roster.ts set w status=working"],
    ["a write in a worktree", "echo x > notes.txt"],
    ["rm elsewhere", "rm -rf /tmp/scratch-dir"],
    [
      "the CLI's render through ext put of a doc",
      "playground ext put login doc audit-x /tmp/a.md --reason why",
    ],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test("a reader inside the root", async () => {
    expect(await bash("cat policy.json", ROOT)).toBeUndefined()
  })

  test.each([
    ["Read is no write", "Read", { file_path: LIST }],
    ["Write elsewhere", "Write", { content: "x", file_path: join(DATA, "handoffs", "w.md") }],
    [
      "Edit of a sibling folder named alike",
      "Edit",
      { file_path: join(DATA, "extensions-notes", "a.md") },
    ],
  ])("%s", async (_, name, input) => {
    expect(await tool(name, input)).toBeUndefined()
  })
})

describe("a playground CLI call that changes what a guard reads is refused, naming the owner's route", () => {
  test.each([
    [
      "ext put of a list",
      "playground ext put login list desktop-owner-apps /tmp/l.json --reason x",
    ],
    [
      "ext put of a list past an option",
      "playground ext put --reason x login list release-owners -",
    ],
    [
      "ext put of a list by the CLI's path",
      "bun ~/playground/packages/scripts/src/playground/cli.ts ext put login list x /tmp/l.json --reason y",
    ],
    [
      "ext put of a list by bun run",
      "bun run packages/scripts/src/playground/cli.ts ext put login list x /tmp/l.json --reason y",
    ],
    [
      "ext put of a list by the bin's path",
      "~/.bun/bin/playground ext put login list x /tmp/l.json --reason y",
    ],
    [
      "ext put of a list through run-slot",
      "~/.playground/ops/run-slot.sh w -- playground ext put login list x /tmp/l.json --reason y",
    ],
    [
      "ext put of a list through bash -c",
      "bash -c 'playground ext put login list x /tmp/l.json --reason y'",
    ],
    ["ext import --from-tree", "playground ext import --from-tree extensions/core/lists"],
    ["ext import of a folder", "playground ext import /tmp/scopes"],
    ["ext sync", "playground ext sync"],
    ["ext sync of one scope", "playground ext sync login"],
    ["ext add", "playground ext add acme --yes"],
    ["ext init", "playground ext init --yes"],
    ["ext remove", "playground ext remove acme"],
    ["ext link", "playground ext link acme '*'"],
    ["ext unlink", "playground ext unlink acme acme-org"],
    ["ext order", "playground ext order acme login"],
    ["ext remove with a --dry-run it ignores", "playground ext remove acme --dry-run"],
    ["settings set of ext.links", "playground settings set ext.links '{}' --reason x"],
    ["settings set of owner.names", "playground settings set owner.names '[]' --reason x"],
    [
      "settings set of factory.archiveRepo",
      "playground settings set factory.archiveRepo a/b --reason x",
    ],
    [
      "settings set of factory.publicRepo",
      "playground settings set factory.publicRepo a/b --reason x",
    ],
    [
      "settings set of usage.keychainService",
      "playground settings set usage.keychainService x --reason x",
    ],
    [
      "settings set of glm.readOnlyLoad5",
      "playground settings set glm.readOnlyLoad5 99 --reason x",
    ],
    [
      "settings set of a guard key past an option",
      "playground settings set --scope acme owner.names '[]' --reason x",
    ],
    ["settings reset of a guard key", "playground settings reset glm.readOnlyLoad5 --reason x"],
    ["settings set of a key the hook cannot read", 'playground settings set "$KEY" 1 --reason x'],
    ["migrate", "playground migrate --archive /tmp/a --pre-squash abc --org acme"],
    ["uninstall --purge", "playground uninstall --purge"],
    ["a command word the hook cannot read", 'playground "$CMD" put login list x /tmp/l.json'],
    ["an ext verb the hook cannot read", 'playground ext "$VERB" acme'],
    ["ext put of a kind the hook cannot read", 'playground ext put login "$KIND" x /tmp/l.json'],
  ])("%s", async (_, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-extensions-write hook refuses")
    expect(reason).toContain("!")
  })
})

describe("a playground CLI call that no guard reads runs", () => {
  test.each([
    ["ext put of a doc", "playground ext put login doc plan-x /tmp/p.md --reason x"],
    ["ext put of a rule", "playground ext put login rule voice /tmp/r.md --reason x"],
    ["ext put of a skill", "playground ext put login skill x /tmp/s --reason x"],
    ["ext list", "playground ext list"],
    ["ext show of a list", "playground ext show login list release-owners"],
    ["ext search", "playground ext search guard list"],
    ["ext which", "playground ext which playbook"],
    ["ext why of a list", "playground ext why login list release-owners"],
    ["ext diff", "playground ext diff login list x --from a --to b"],
    ["ext export", "playground ext export /tmp/out"],
    ["ext score", "playground ext score login doc x abc 5 --reason ok"],
    ["ext accept", "playground ext accept login rule x abc --reason ok"],
    ["ext import --dry-run", "playground ext import --from-tree extensions/core/lists --dry-run"],
    ["ext init --dry-run", "playground ext init --dry-run"],
    ["ext add --dry-run", "playground ext add acme --dry-run"],
    ["settings list", "playground settings list"],
    ["settings get", "playground settings get owner.names"],
    ["settings why", "playground settings why ext.links"],
    ["settings set of a key no guard reads", "playground settings set ui.theme dark --reason x"],
    ["settings reset of a key no guard reads", "playground settings reset ui.theme --reason x"],
    [
      "settings import-jobs, which writes jobs.* keys alone",
      "playground settings import-jobs /tmp/jobs.json",
    ],
    ["rules", "playground rules voice"],
    ["uninstall without --purge", "playground uninstall"],
    ["status", "playground status"],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toBeUndefined()
  })
})

describe("the hook's run", () => {
  test("it fails open on input it cannot read", async () => {
    expect(await check("not json", ENV)).toBeUndefined()
  })

  test("a machine with no extensions root still refuses a write that would make one", async () => {
    const home = mkdtempSync(join(tmpdir(), "no-extensions-write-bare-"))
    try {
      const reason = await check(
        JSON.stringify({
          cwd: home,
          tool_input: { command: `mkdir -p ${home}/.playground/extensions/hooks` },
          tool_name: "Bash",
        }),
        { HOME: home },
      )
      expect(reason).toContain("no-extensions-write hook refuses")
    } finally {
      rmSync(home, { force: true, recursive: true })
    }
  })
})
