import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-roster-write"

const root = join(import.meta.dir, "..", "..", "..")
const HOME = homedir()
const DATA = join(HOME, ".playground")
const ROSTER = join(DATA, "roster.json")
const environment = { HOME }

const call = (tool_name: string, tool_input: Record<string, unknown>, env: object = environment) =>
  check(
    JSON.stringify({ cwd: root, hook_event_name: "PreToolUse", tool_input, tool_name }),
    env as Record<string, string>,
  )
const bash = (command: string, env: object = environment) => call("Bash", { command }, env)
// A Codex session's edit (codex-cli 0.167.1): its apply_patch call carries the patch as its command, and a turn_id
const patch = (path: string) =>
  check(
    JSON.stringify({
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_input: {
        command: `*** Begin Patch\n*** Update File: ${path}\n@@\n-a\n+b\n*** End Patch`,
      },
      tool_name: "apply_patch",
      turn_id: "turn-1",
    }),
    environment,
  )

describe("a write to the live roster is refused, naming roster.ts", () => {
  test.each([
    ["Edit", { file_path: ROSTER, new_string: "b", old_string: "a" }],
    ["MultiEdit", { edits: [], file_path: ROSTER }],
    ["Write", { content: "{}", file_path: ROSTER }],
    ["Write", { content: "{}", file_path: join(HOME, ".PLAYGROUND", "Roster.json") }],
  ] as const)("%s %o", async (tool, input) => {
    const reason = await call(tool, input)
    expect(reason).toContain("no-roster-write hook refuses")
    expect(reason).toContain("bun scripts/roster.ts set")
  })

  test.each([
    "echo '{}' > ~/.playground/roster.json",
    `echo '{}' >> ${ROSTER}`,
    "echo x >| $HOME/.playground/roster.json",
    "jq . x.json | tee ~/.playground/roster.json",
    "sed -i '' 's/a/b/' ~/.playground/roster.json",
    "sed -i.bak 's/a/b/' ~/.playground/roster.json",
    "sed --in-place 's/a/b/' ~/.playground/roster.json",
    "cp /tmp/roster.json ~/.playground/roster.json",
    "cp /tmp/roster.json ~/.playground/",
    "cp -t ~/.playground /tmp/roster.json",
    "mv /tmp/new.json ~/.playground/roster.json",
    "mv ~/.playground/roster.json /tmp/old.json",
    "ln -sf /tmp/x.json ~/.playground/roster.json",
    "rm ~/.playground/roster.json",
    "truncate -s 0 ~/.playground/roster.json",
    "cd ~/.playground && echo x > roster.json",
    "R=~/.playground/roster.json; echo x > $R",
    "echo x > ~/.playground/roster.*",
    "echo x > ~/.playground/r?ster.json",
    "bash -c 'echo x > ~/.playground/roster.json'",
    "F=$(echo ~/.playground/roster.json); echo x > $F",
    // inline code that names the roster and holds a write word, failing closed when the write goes elsewhere
    `python3 -c "open('${ROSTER}', 'w').write('{}')"`,
    "bun -e \"await Bun.write(process.env.HOME + '/.playground/roster.json', '{}')\"",
    "node -e \"require('fs').writeFileSync(process.env.HOME + '/.playground/roster.json', '{}')\"",
    `perl -e 'unlink "${ROSTER}"'`,
    `python3 -I -c "import json,os; a=json.load(open(os.path.expanduser('~/.playground/roster.json'))); open(os.path.expanduser('~/.playground/ops/x.priority'), 'w').write(str(len(a)))"`,
    `bun /tmp/probe.ts 'echo x > "$(echo ~/.playground/roster.json)"'`,
    'echo x > "$D"/roster.json # ~/.playground/roster.json',
    'echo x > "$(echo ~/.playground/roster.json)"',
    // #3036: a write that reaches the roster through stdin or a search
    `echo ${ROSTER} | xargs rm`,
    `echo ${ROSTER} | xargs -I{} cp /tmp/x {}`,
    "find ~/.playground -name roster.json -delete",
    "find ~/.playground -name roster.json -exec rm {} \\;",
    "find ~/.playground -exec rm {} +",
    "find ~/.playground ! -name x.json -delete",
    "gfind ~/.playground -iname ROSTER.JSON -delete",
    "cd ~/.playground && find -name roster.json -delete",
    "find ~/.playground -name '*.json' -delete",
    "find ~/.playground -name roster.json | xargs rm",
    "find /tmp -fprint ~/.playground/roster.json",
    // #3040: the programs kept refused on the roster, which can write it or run code
    `awk '{print > "${ROSTER}"}' /tmp/x`,
    `awk '{print $1}' ${ROSTER}`,
    `sort -o ${ROSTER} /tmp/x`,
    `sort ${ROSTER}`,
    `xxd /tmp/x ${ROSTER}`,
    `xxd ${ROSTER}`,
    `python3 -m json.tool ${ROSTER}`,
    `python3 /tmp/x.py ${ROSTER}`,
    `node /tmp/x.js ${ROSTER}`,
    `git diff --no-index ${ROSTER} /tmp/x`,
    `watch -n5 cat ${ROSTER}`,
    `yq . ${ROSTER}`,
    `fx ${ROSTER}`,
  ])("%s", async (command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-roster-write hook refuses")
    expect(reason).toContain("bun scripts/roster.ts set")
  })

  // #3037: a Codex session's apply_patch reaches the file-tool check as one Write per file
  test("a Codex apply_patch of the roster", async () => {
    expect(await patch(ROSTER)).toContain("no-roster-write hook refuses")
  })

  test("it follows PLAYGROUND_DATA_DIR", async () => {
    const env = { HOME, PLAYGROUND_DATA_DIR: "/made-up-data" }
    expect(await bash("echo x > /made-up-data/roster.json", env)).toContain("no-roster-write")
    expect(await bash("echo x > $PLAYGROUND_DATA_DIR/roster.json", env)).toContain(
      "no-roster-write",
    )
    expect(
      await call("Write", { content: "{}", file_path: "/made-up-data/roster.json" }, env),
    ).toContain("no-roster-write")
  })
})

describe("roster.ts and every read run", () => {
  test.each([
    "bun scripts/roster.ts set 6jf45s-worker eta=2026-11-24T20:30:00Z",
    'bun "${PLAYGROUND_REPO:?}/scripts/roster.ts" set x status=ended',
    "jq '.agents[] | .name' ~/.playground/roster.json",
    `jq -r .agents ${ROSTER} > /tmp/agents.json`,
    "cat ~/.playground/roster.json",
    "grep -c name ~/.playground/roster.json",
    "head -5 ~/.playground/roster.json",
    "ls -l ~/.playground/roster.json",
    "stat ~/.playground/roster.json",
    "wc -c < ~/.playground/roster.json",
    "diff ~/.playground/roster.json /tmp/r.json",
    "sed -n 1,5p ~/.playground/roster.json",
    "cp ~/.playground/roster.json /tmp/roster.json",
    "cp ~/.playground/roster.json.1 ~/.playground/roster.json.2",
    "echo x > ~/.playground/roster.json.tmp",
    "echo x > ~/.playground/merge-queue.json",
    "echo x > /tmp/roster.json",
    "[ -f ~/.playground/roster.json ] && echo yes",
    "git commit -m 'guard ~/.playground/roster.json from hand edits'",
    "gh issue comment 1 --body 'the live roster is ~/.playground/roster.json'",
    "cat > /tmp/other.md <<EOF\nthe roster is ~/.playground/roster.json\nEOF",
    "echo 'edit ~/.playground/roster.json only through roster.ts' > /tmp/other.md",
    "printf '%s\\n' ~/.playground/roster.json",
    "bun -e 'const r = JSON.parse(await Bun.file(process.env.HOME + \"/.playground/roster.json\").text()); console.log(r)'",
    `python3 -I -c "import json; r = json.load(open('${ROSTER}')); print(json.dumps(r)[:80])"`,
    "bun -e 'const r = JSON.parse(await Bun.file(process.env.HOME + \"/.playground/roster.json\").text()); for (const s of r.agents.filter((a) => a.n >= 1)) console.log(s.name)'",
    // pass controls for the placers, the writers and sed the review's bypass forms reach
    "mv /tmp/a.json /tmp/b.json && cat ~/.playground/roster.json",
    "rsync -a src/ dst/",
    "rsync -t /tmp/x /tmp/y",
    "cp /tmp/notes.json ~/.playground/",
    "ln -s ~/.playground/handoffs /tmp/handoffs",
    "install -m 600 /tmp/x ~/.playground/scratch/x",
    "sed -E 's/a/b/' ~/.playground/roster.json > /tmp/out.json",
    "sed -n 'w /tmp/out.json' ~/.playground/roster.json",
    "sed -n 's/x/y/w /tmp/out' ~/.playground/roster.json",
    "sed -n '/x/{p;w /tmp/o\n}' ~/.playground/roster.json",
    "sed -n 1p ~/.playground/roster.json",
    "gsed -n 1p ~/.playground/roster.json",
    "grep -c worker ~/.playground/roster.json",
    "gcat ~/.playground/roster.json",
    "gcp ~/.playground/roster.json /tmp/roster.json",
    "rm /tmp/x.json; tee /tmp/y < ~/.playground/roster.json",
    'F=$(mktemp); touch "$F"',
    // real calls the replay found, each a read of the roster
    'n="$(head -c 6 /dev/urandom | xxd -p)-worker"; grep -c "$n" ~/.playground/roster.json; sed "s/x/y/" /tmp/t.md > ~/.playground/brief-$n.md',
    `bun scripts/roster.ts assign x-reviewer "Review: $(jq -r '.title' ~/.playground/roster.json)" "score PR 1" worker=x-worker`,
    // #3036: a read through stdin or a search
    "find ~/.playground -name roster.json",
    "find ~/.playground -name roster.json | xargs cat",
    `echo ${ROSTER} | xargs cat`,
    `echo ${ROSTER} | xargs -I{} cp {} /tmp/roster.json`,
    "find ~/.playground -name roster.json -exec cat {} \\;",
    "find ~/.playground -name '*.tmp' -delete",
    "find ~/.playground/scratch -delete",
    "echo /tmp/x | xargs rm",
    // pass controls: ordinary find and xargs calls, none of which reaches the roster
    "find . -name '*.ts' -exec grep -l roster {} +",
    "find ~ -name '*.log' -mtime +7 -delete",
    "find ~/.playground -maxdepth 1 -type f",
    "find ~/.playground/scratch -name '*.png' -exec rm {} \\;",
    "find /tmp -fprint /tmp/list.txt",
    "git ls-files | xargs grep -l roster",
    "ls /tmp/*.json | xargs -I{} mv {} /tmp/old/",
    "printf '%s\\0' a b | xargs -0 rm",
    // #3055's review: a read the find and xargs rules leave running, the refused forms being refused-forms/3055.ts
    "find ~/.playground -name roster.json -print",
    `find /tmp -maxdepth 0 -execdir sh -c 'cat ${ROSTER}' \\;`,
    "find . -name node_modules -prune -o -name '*.ts' -print",
    "find /tmp -name '*.log' -delete",
    "find -x /tmp -name '*.log' -delete",
    `find /opt/none -newer ${ROSTER} -delete`,
    "git ls-files -z | xargs -0 grep -l x",
    "find . -type f | xargs grep -l TODO",
    "ls | xargs wc -l",
    "echo /tmp/a | xargs rm",
    "ls /opt/none | xargs rm",
    "echo /tmp | xargs -I{} rm {}/x.json",
    "find ~/.playground -name '*.png' | xargs cat",
    `echo ${ROSTER} | gxargs cat`,
    `cat ${ROSTER} | python3 -c 'import json,sys; print(json.load(sys.stdin))'`,
    "find ~/.playground/scratch -name '*.png' -exec sh -c 'rm \"$0\"' {} \\;",
    `jq -r '.agents[].name' ${ROSTER} | head -3 | xargs -n1 bun scripts/roster.ts get`,
    `echo ${Array.from({ length: 101 }, (_, i) => `/tmp/x${i}`).join(" ")} | xargs cat`,
    // past ITEMS fed items, a program that writes no operand still runs, as the differential's touched-test runs do
    `echo ${Array.from({ length: 101 }, (_, i) => `tests/x${i}.test.ts`).join(" ")} | xargs bun run test:file`,
    `echo ${Array.from({ length: 101 }, (_, i) => `w${i}`).join(" ")} | python3 -c 'import sys; print(sys.stdin.read())'`,
    // past ITEMS fed items with no roster near, a writer runs too, as at canary
    `echo ${Array.from({ length: 101 }, (_, i) => `/opt/none/x${i}`).join(" ")} | xargs rm`,
    // #3040: plain readers and their GNU copies
    `cut -d, -f1 ${ROSTER}`,
    `column -t ${ROSTER}`,
    `du -h ${ROSTER}`,
    `md5sum ${ROSTER}`,
    `nl ${ROSTER}`,
    `od -c ${ROSTER}`,
    `sha1sum ${ROSTER}`,
    `gcut -c1-5 ${ROSTER}`,
    `ghead -1 ${ROSTER}`,
    `gmd5sum ${ROSTER}`,
  ])("%s", async (command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test.each([
    ["Read", { file_path: ROSTER }],
    ["Write", { content: "x", file_path: join(DATA, "merge-queue.json") }],
    ["Write", { content: "x", file_path: join(DATA, "roster.json.1") }],
    ["Edit", { file_path: "/tmp/roster.json", new_string: "b", old_string: "a" }],
  ] as const)("%s %o", async (tool, input) => {
    expect(await call(tool, input)).toBeUndefined()
  })

  test("a Codex apply_patch of another file", async () => {
    expect(await patch(join(DATA, "merge-queue.json"))).toBeUndefined()
  })
})

// The session's own folder is the shell's: a relative path and unseen input are read from it, with no cd in the call
describe("a call whose session sits in the data folder", () => {
  const inData = (command: string) =>
    check(
      JSON.stringify({
        cwd: DATA,
        hook_event_name: "PreToolUse",
        tool_input: { command },
        tool_name: "Bash",
      }),
      environment,
    )

  test.each(["rm roster.json", "ls | xargs rm"])("refuses %s", async (command) => {
    expect(await inData(command)).toContain("scripts/roster.ts")
  })

  test.each(["cat roster.json", "jq -r '.agents[].name' roster.json", "ls | xargs cat"])(
    "runs %s",
    async (command) => {
      expect(await inData(command)).toBeUndefined()
    },
  )
})

// It has no process of its own: no-raw-wa's, registered on the file tools, runs it there.
test("no-raw-wa's process refuses a factory session's Write of the roster, in this hook's name", async () => {
  const proc = Bun.spawn(["bun", "--no-env-file", join(root, "scripts", "hooks", "no-raw-wa.ts")], {
    env: { ...process.env, PLAYGROUND_ROLE: "worker" },
    stderr: "pipe",
    stdin: new Blob([
      JSON.stringify({
        cwd: root,
        tool_input: { content: "{}", file_path: ROSTER },
        tool_name: "Write",
      }),
    ]),
  })
  expect(await proc.exited).toBe(2)
  expect(await new Response(proc.stderr).text()).toContain("no-roster-write hook refuses")
})
