import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { check, GUARD_KEYS, guarded } from "../../../scripts/hooks/no-extensions-write"

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
const WORK = join(HOME, "work")
const BIG = [join(HOME, "big-a"), join(HOME, "big-b")]
for (const file of BIG) writeFileSync(file, "x".repeat(900_000))
const WORDS = join(HOME, "words")
writeFileSync(WORDS, "y ".repeat(400_000))
mkdirSync(join(WORK, "playground"), { recursive: true })
symlinkSync(ROOT, LINK)
// Links whose names no glob of the root's own names matches: one to the root in the data folder, one to the data folder in the home.
symlinkSync(ROOT, join(DATA, "store"))
symlinkSync(DATA, join(HOME, "pg"))
afterAll(() => rmSync(HOME, { force: true, recursive: true }))

const ENV = { HOME }
const CHECKOUT = join(import.meta.dir, "..", "..", "..")
const CLI_DIR = join(CHECKOUT, "packages", "scripts", "src", "playground")

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

// A harmless git alias nest of the given depth around an inner command line, each level double-quoted.
const escape = (text: string) => text.replace(/[\\"$`]/g, (c) => `\\${c}`)
const nest = (depth: number, inner: string): string =>
  depth === 0 ? inner : `git -c alias.x="!${escape(nest(depth - 1, inner))}" x`

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
    expect(reason).toContain(
      "the owner typing the playground command as a ! command in the dispatcher's terminal window, which runs without hooks: tell your lead, and the dispatcher hands the owner the command.",
    )
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
    ["a glob in the data folder", `rm -rf ${DATA}/*`],
    ["a glob naming the root", `rm -rf ${DATA}/ext*`],
    ["a relative glob after a cd into the data folder", `cd ${DATA} && rm -rf ext*`],
    ["trash of the data folder", `trash ${DATA}`],
    ["rm under xargs, its paths on stdin", `echo ${DATA} | xargs rm -rf`],
    ["cp -R into the data folder", `cp -R /tmp/fake/ ${DATA}/`],
    ["ditto onto the data folder", `ditto /tmp/x ${DATA}`],
    [
      "a link to the data folder made in the same call",
      `ln -s ${DATA} /tmp/l && cp /tmp/x /tmp/l/extensions/hooks/a.json`,
    ],
    ["curl's output attached to -o", `curl -o${LIST} https://example.com`],
    ["sort's output attached to -o", `sort -o${LIST} /tmp/x`],
    ["tar's folder attached to -C", `tar -xf a.tar -C${ROOT}/hooks`],
    ["unzip's folder attached to -d", `unzip -o x.zip -d${ROOT}`],
    ["a versioned python", `python3.15 -c "open('${LIST}','w')"`],
    ["swift -e", `swift -e 'print("${LIST}")'`],
    ["a heredoc to tclsh", `tclsh <<'EOF'\nset f [open "${LIST}" w]\nEOF`],
    ["sqlite3's .output", `sqlite3 :memory: ".output ${LIST}" "select 1"`],
    ["a git alias that runs a shell", `git -c alias.st='!rm -rf ${ROOT}' st`],
    ["rg --pre, which runs a program on each file", `rg --pre /tmp/w.sh x ${ROOT}`],
    ["git grep -O, which opens files in a program", `git -C ${SCOPE} grep -O/tmp/w.sh x`],
    ["git -c on a read", `git -C ${SCOPE} -c core.fsmonitor=/tmp/w.sh status`],
    ["GIT_PAGER on a read", `GIT_PAGER=/tmp/w.sh git -C ${SCOPE} log`],
    ["an exported PAGER before a read", `export PAGER=/tmp/w.sh; git -C ${SCOPE} log`],
    ["a brace word naming the root", `rm -rf ${DATA}/{extensions,x}`],
    ["GIT_DIR set to a scope's clone", `GIT_DIR=${SCOPE}/.git git reset --hard`],
    ["GIT_WORK_TREE exported to a scope", `export GIT_WORK_TREE=${SCOPE}; git checkout -- .`],
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

  test("a script naming the root relative to a cwd above it", async () => {
    const reason = await bash(
      `python3.15 -c "open('.playground/extensions/hooks/a.json','w')"`,
      HOME,
    )
    expect(reason).toContain("no-extensions-write hook refuses")
  })

  test("a heredoc naming the root relative to a cwd above it", async () => {
    const reason = await bash("python3 - <<'EOF'\nopen('extensions/policy.json','w')\nEOF", DATA)
    expect(reason).toContain("no-extensions-write hook refuses")
  })

  test.each([
    ["-S attached", `env -S'bun ${CLI_DIR}/cli.ts' settings set owner.names x --reason r`],
    [
      "--split-string=",
      `env --split-string='bun ${CLI_DIR}/cli.ts' settings set owner.names x --reason r`,
    ],
    ["-v -S", `env -v -S 'bun ${CLI_DIR}/cli.ts' settings set owner.names x --reason r`],
    ["-vS attached", `env -vS'bun ${CLI_DIR}/cli.ts' settings set owner.names x --reason r`],
  ])("the CLI behind env %s", async (_, command) => {
    expect(await bash(command)).toContain("no-extensions-write hook refuses")
  })

  test("the CLI behind env -S", async () => {
    const reason = await bash(
      `env -S 'bun ${CLI_DIR}/cli.ts' settings set owner.names x --reason r`,
    )
    expect(reason).toContain("no-extensions-write hook refuses")
  })

  test.each([
    ["a group's redirect", `{ echo '[]'; } > ${LIST}`],
    ["a subshell's redirect", `( echo '[]' ) > ${LIST}`],
    ["a bare redirect", `> ${LIST}`],
    ["exec's redirect", `exec > ${LIST}`],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toContain("no-extensions-write hook refuses")
  })

  test.each([
    [
      "bun --cwd to the CLI's folder, from the checkout",
      "bun --cwd packages/scripts/src/playground cli.ts ext put login list x /tmp/l.json --reason y",
    ],
    ["the command's name in upper case", "PLAYGROUND ext put login list x /tmp/l.json --reason y"],
    [
      "the CLI behind find -exec",
      "find /tmp -maxdepth 0 -exec playground ext put login list x /tmp/l.json --reason y ';'",
    ],
    ["the CLI behind arch", "arch -arm64 playground settings set owner.names x --reason r"],
    ["the CLI behind watch", "watch playground ext sync"],
    ["the CLI behind npm exec", "npm exec -- playground ext sync"],
    ["settings set of ext.repos", "playground settings set ext.repos '{}' --reason r"],
  ])("%s", async (_, command) => {
    expect(await bash(command, CHECKOUT)).toContain("no-extensions-write hook refuses")
  })

  test.each([
    ["a substitution in ${X:-…}", `echo \${X:-$(touch ${LIST})}`],
    ["a substitution in ${X:=…}", `: \${X:=$(touch ${LIST})}`],
    ["a substitution in ${X:+…}", `echo \${X:+$(touch ${LIST})}`],
    ["a substitution in ${X/a/…}", `echo \${X/a/$(touch ${LIST})}`],
    ["a substitution in ${X#…}", `echo \${X#$(touch ${LIST})}`],
    ["a backquote in ${X:-…}", `echo \${X:-\`touch ${LIST}\`}`],
    ["a substitution in $((…))", `echo $(($(touch ${LIST})+1))`],
    ["rm -rf of the data folder in ${X:-…}", `echo \${X:-$(rm -rf ${DATA})}`],
    ["the CLI in ${X:-…}", "echo ${X:-$(playground ext sync)}"],
    ["bash reading a process substitution", `bash <(echo touch ${LIST})`],
    ["zsh reading a process substitution", `zsh <(echo touch ${LIST})`],
    ["source of a process substitution", `source <(echo touch ${LIST})`],
    [". of a process substitution", `. <(echo touch ${LIST})`],
    ["sh reading a process substitution as stdin", `sh < <(echo touch ${LIST})`],
    ["sh -s reading a process substitution as stdin", `sh -s < <(echo touch ${LIST})`],
    ["bash reading /dev/stdin", `bash /dev/stdin <<< 'touch ${LIST}'`],
    ["bash reading a heredoc's process substitution", `bash <(cat <<'EOF'\ntouch ${LIST}\nEOF\n)`],
    ["the CLI as git's pager", "GIT_PAGER='playground ext sync' git log"],
    ["the CLI as git's -c pager", "git -c core.pager='playground ext sync' log"],
    ["a write as PAGER", `PAGER='touch ${LIST}' git log`],
    ["the CLI as watch's command line", "watch -n1 'playground ext sync'"],
    ["the CLI as tmux's command line", "tmux new -d 'playground ext sync'"],
    [
      "the CLI as sh -c's script under find -exec",
      "find /tmp -maxdepth 0 -exec sh -c 'playground ext sync' ';'",
    ],
    ["the CLI as sh -c's script under arch", "arch -arm64 sh -c 'playground ext sync'"],
    ["the CLI as ssh's ProxyCommand", "ssh -o ProxyCommand='playground ext sync' host"],
    ["the CLI as rsync's shell", "rsync -e 'playground ext sync' /tmp/a host:/tmp/b"],
    ["the CLI as script's command", "script -q -c 'playground ext sync' /dev/null"],
    ["the CLI as concurrently's command", "npx -y concurrently 'playground ext sync'"],
    ["the CLI as a git alias", "git -c alias.x='!playground ext sync' x"],
    ["the CLI as MANPAGER", "MANPAGER='playground ext sync' man ls"],
    ["the CLI as GH_PAGER", "GH_PAGER='playground ext sync' gh pr view 1"],
    [
      "the CLI as git's --config-env pager",
      "X='playground ext sync' git --config-env=core.pager=X log",
    ],
    [
      "a commit message holding a gated call",
      `git commit -m "docs: the hook refuses playground ext sync now"`,
    ],
    ["a write after a word with an unbalanced quote", `git commit -m "it's"; rm -rf ${ROOT}`],
    [
      "the CLI by name from a cwd holding a folder named playground",
      `cd ${WORK} && playground ext sync`,
    ],
    ["the CLI by name under env -C to such a folder", `env -C ${WORK} playground ext sync`],
    ["the CLI's words from xargs' stdin", "printf 'ext sync' | xargs playground"],
    ["the CLI's words from xargs' here-string", `xargs playground <<< "ext sync"`],
    [
      "the CLI's words through xargs -I into sh -c",
      "printf 'ext sync' | xargs -I{} sh -c 'playground {}'",
    ],
    ["a redirect on bash -c", `bash -c true > ${LIST}`],
    ["a redirect on eval", `eval true > ${LIST}`],
    ["a redirect on cd", `cd /tmp > ${LIST}`],
    [
      "a process substitution whose first command prints the script",
      `bash <(echo 'rm ${LIST}'; echo true)`,
    ],
    ["a group's output piped into sh", `{ echo 'rm ${LIST}'; echo true; } | sh`],
    ["a subshell's output piped into sh", `( echo 'rm ${LIST}'; echo true ) | sh`],
    ["rg with --hostname-bin", `rg --hostname-bin /tmp/w.sh x ${ROOT}`],
    ["settings set of ext.order", "playground settings set ext.order login --reason r"],
    ["settings reset of ext.order", "playground settings reset ext.order --reason r"],
    ["a redirect into a [ ] glob", `echo '{}' > ${DATA}/extensio[n]s/policy.json`],
    ["a redirect into a ? glob", `echo '{}' > ${DATA}/extensio?s/policy.json`],
    ["a redirect into a * glob", `echo '{}' > ${DATA}/ext*/policy.json`],
    ["zsh's >! redirect", `echo '[]' >! ${LIST}`],
    ["zsh's >>! redirect", `echo '[]' >>! ${LIST}`],
    [
      "a one-line nested group's output piped into sh",
      `{ { echo 'rm ${LIST}'; }; echo true; } | sh`,
    ],
    ["rm of a zsh ( ) glob", `rm -rf ${DATA}/extensio(n)s`],
    ["env -C attached to a scope", `env -C${SCOPE} git reset --hard`],
    ["env --chdir= to a scope", `env --chdir=${SCOPE} git reset --hard`],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toContain("no-extensions-write hook refuses")
  })

  test("a deep harmless nest ahead of the CLI is judged before the hook's timeout", async () => {
    const reason = await bash(`${nest(16, "true")}; playground ext sync`)
    expect(reason).toContain("no-extensions-write hook refuses")
  }, 10_000)

  test("many variables ahead of a write are judged before the hook's timeout", async () => {
    const vars = Array.from({ length: 800 }, (_, i) => `V${i}=x${i}`).join("; ")
    const reason = await bash(`${vars}; ${": ; ".repeat(800)}rm -rf ${ROOT}`)
    expect(reason).toContain("no-extensions-write hook refuses")
  }, 10_000)

  test.each([
    ["nested substitutions", `x=${"$(".repeat(20_000)}${")".repeat(20_000)}; playground ext sync`],
    ["nested groups", `${"(".repeat(20_000)}true${")".repeat(20_000)}; playground ext sync`],
    [
      "nested quoted substitutions",
      `${'"$('.repeat(5_000)}${')"'.repeat(5_000)}; playground ext sync`,
    ],
  ])("%s too deep for the reader's stack are refused", async (_, command) => {
    expect(await bash(command, "/tmp")).toContain("no-extensions-write hook refuses")
  })

  test("a command longer than the reader can lex inside the hook's time is refused", async () => {
    const reason = await bash(`echo ${"${a:-".repeat(30_000)}${"}".repeat(30_000)}`, "/tmp")
    expect(reason).toContain("split it into shorter calls")
  })

  test("a long run of closing braces ahead of the CLI is read inside the hook's time", async () => {
    const started = performance.now()
    const reason = await bash(`${"ls; }\n".repeat(21_000)}playground ext sync`, "/tmp")
    expect(reason).toContain("no-extensions-write hook refuses")
    expect(performance.now() - started).toBeLessThan(1_000)
  }, 20_000)

  // a variable set once, then a program after each, at the cap
  const variables = (each: string) => {
    let script = ""
    for (let i = 0; script.length < 130_000; i++) script += `V${i}=x${i}; ${each}`
    return `${script}true`
  }
  const fill = (head: string, unit: string, tail: string) =>
    head + unit.repeat(Math.floor((130_000 - head.length - tail.length) / unit.length)) + tail
  test.each([
    ["a brace with no close", fill("echo {", ",", ""), false, 1_000],
    [
      "xargs -I over a large stdin",
      fill(`cat ${WORDS} | xargs -I@ git -c alias.x="!`, "@ ", '" x'),
      true,
      1_000,
    ],
    ["env -S", fill("env -S'", "-S ", "' true"), false, 1_000],
    // each variable's path is still read from the filesystem, so these take longer, inside bounds canary misses (2.4 to 2.9 s and 6 to 9.5 s)
    ["distinct variables", variables(""), false, 2_000],
    ["distinct variables, each with a program", variables("true; "), false, 3_000],
    [
      "a printf escape format over many arguments",
      `printf '%s${"\\\\x41".repeat(16_000)}' ${"x ".repeat(3_000)}> /tmp/nxw-p`,
      false,
      1_000,
    ],
  ])(
    "%s at the command cap is read inside its bound",
    async (_, command, refused, bound) => {
      const started = performance.now()
      const reason = await bash(command, "/tmp")
      if (refused) expect(reason).toContain("split it into shorter calls")
      else expect(reason).toBeUndefined()
      expect(performance.now() - started).toBeLessThan(bound)
    },
    60_000,
  )

  test.each([300, 8_000])(
    "an eval chain %d deep ahead of a write is refused inside the hook's time",
    async (depth) => {
      const started = performance.now()
      const reason = await bash(`${"eval 'eval '\\''".repeat(depth)}\nrm ${LIST}`, "/tmp")
      expect(reason).toContain("no-extensions-write hook refuses")
      expect(performance.now() - started).toBeLessThan(12_000)
    },
    60_000,
  )

  test.each([
    ["24 doubling cat stages", `echo hi | ${"cat - - | ".repeat(24)}bash; echo x > ${LIST}`],
    [
      "12 rounds of files that double each other",
      `echo a > /tmp/nxw-f; ${"cat /tmp/nxw-f /tmp/nxw-f > /tmp/nxw-g; cat /tmp/nxw-g /tmp/nxw-g > /tmp/nxw-f; ".repeat(12)}bash < /tmp/nxw-f; echo x > ${LIST}`,
    ],
    ["a 120 KB path", `touch /tmp/${"a/".repeat(60_000)}x; echo x > ${LIST}`],
    [
      "a printf format of 100000 zeros through three cat stages",
      `printf '%${"0".repeat(100_000)}!' | cat > /tmp/nxw-a | cat > /tmp/nxw-b | cat > /tmp/nxw-c; echo x > ${LIST}`,
    ],
    [
      "4600 reads of a 45 KB file in one word",
      `echo ${"A".repeat(45_000)} > /tmp/nxw-r; echo "${"$(cat /tmp/nxw-r)".repeat(4_600)}" > /tmp/nxw-o; echo x > ${LIST}`,
    ],
  ])(
    "%s ahead of a write are read inside the hook's time",
    async (_, command) => {
      const started = performance.now()
      expect(await bash(command, "/tmp")).toContain("no-extensions-write hook refuses")
      expect(performance.now() - started).toBeLessThan(3_000)
    },
    60_000,
  )

  test.each([
    [
      "a group whose first part it cannot read",
      `{ curl -s https://example.com; echo 'echo x > ${LIST}'; } | bash`,
    ],
    [
      "a group whose second part it cannot read",
      `{ echo 'echo x > ${LIST}'; curl -s https://example.com; } | bash`,
    ],
    [
      "a subshell with a part it cannot read",
      `(curl -s https://example.com; echo 'echo x > ${LIST}') | sh`,
    ],
    [
      "a process substitution with a part it cannot read",
      `bash <(curl -s https://example.com; echo 'echo x > ${LIST}')`,
    ],
    ["cat of a file it cannot read and stdin", `echo 'echo x > ${LIST}' | cat /dev/null - | bash`],
  ])("a shell reading %s still reads the rest", async (_, command) => {
    expect(await bash(command, "/tmp")).toContain("no-extensions-write hook refuses")
  })

  test("a slow lex refuses at the walk's deadline, whatever made it slow", async () => {
    const command = `echo ${"a(".repeat(20_000)}${")".repeat(20_000)}`
    const started = performance.now()
    const reason = await check(
      JSON.stringify({ cwd: "/tmp", tool_input: { command }, tool_name: "Bash" }),
      ENV,
      50,
    )
    expect(reason).toContain("split it into shorter calls")
    expect(performance.now() - started).toBeLessThan(250)
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
    ["rm of the root by ~", "rm ~/.playground/extensions"],
    ["rm of the data folder by ~", "rm ~/.playground"],
    ["a cd by ~, then a relative rm", "cd ~ && rm -rf .playground/extensions/.no-such-folder"],
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

// A quoted argument with a space is read as a command line unless every command on the line is on a closed list of readers (awk with a program that runs nothing, cat, grep, head, tail, wc, sort, uniq, cut), with no redirect that writes a file; an awk program that runs a command has its literals read wherever it stands, and sed keeps canary's reading.
describe("a quoted argument is read as a command line only where a program runs it", () => {
  const real = { HOME: homedir() }
  const at = (command: string, cwd: string) =>
    check(JSON.stringify({ cwd, tool_input: { command }, tool_name: "Bash" }), real)
  const homes = [homedir(), join(homedir(), ".playground")]
  test.each([
    ["awk matching a field to a regex", "awk '$3 ~ /runner/' /dev/null"],
    ["awk matching a field to a string", `awk '$3 ~ "runner"' /dev/null`],
    ["awk matching a line naming a runner", "awk '/watch/' /dev/null"],
    ["awk with a block matching a line naming a runner", "awk '/watch/ {print}' /dev/null"],
    ["awk with its errors sent to /dev/null", "awk '$3 ~ /runner/' /dev/null 2>/dev/null"],
    [
      "awk with its errors joined and piped to head",
      "awk '$3 ~ /runner/' /dev/null 2>&1 | head -3",
    ],
    ["awk reading cat's output", "cat /dev/null | awk '$3 ~ /runner/'"],
    ["awk by its system path", "/usr/bin/awk '$3 ~ /runner/' /dev/null"],
    ["grep over the folder after !", "! grep -r x ."],
    ["grep over the folder after then", "if true; then grep -r x .; fi"],
    ["awk after then", "if grep -q x /dev/null; then awk '$3 ~ /runner/' /dev/null; fi"],
    [
      "grep, awk, sort, uniq and head in a pipe",
      "grep x /dev/null | awk '$3 ~ /runner/' | sort | uniq -c | head -3",
    ],
    ["awk's output cut at a spaced delimiter", "awk '$3 ~ /runner/' /dev/null | cut -d' ' -f1"],
    ["awk's output counted by wc and tail", "awk '$3 ~ /runner/' /dev/null | tail -n 2 | wc -l"],
    ["awk printing a field in a quoted block", "awk '{print $1}' /dev/null"],
    [
      "awk matching a worktree's line with a variable",
      `awk -v b="branch refs/heads/$B" '/^worktree /{w=substr($0,10)} $0==b{print w}' /dev/null`,
    ],
    ["cut at a quoted brace", "cut -d'{' -f1 /dev/null"],
    ["sort keyed at a quoted bracket", "sort -t'[' -k2 /dev/null"],
    ["awk matching a regex that starts at / and holds a glob", "awk '/^a*b/' /dev/null"],
    ["git -c with a literal pager", "git -c core.pager=less log"],
    ["rm of a glob in a build folder", "rm -rf build/*"],
    ["rm of a held folder's glob", "X=build; rm -rf $X/*"],
    ["rm of a held temporary folder", 'D=/tmp/x.1; rm -rf "$D"'],
    ["rm under HOME, which the hook holds", 'rm -rf "$HOME/tmp-x"'],
    ["a quiet commit with -m", `git commit -m "fix(x): y"`],
    ["a quiet commit with -am", `git commit -am "fix(x): y"`],
    ["a quiet commit with --message", `git commit --message "fix(x): y"`],
    ["a quiet commit with --message=", `git commit --message="fix(x): y"`],
    ["a quiet commit with a parenthesised scope and body", `git commit -m "feat(a,b): do (z)"`],
    ["a quiet commit reusing a commit, with a held message", `git commit -C HEAD -m "fix(x): y"`],
    ["a quiet commit by a system path", `/usr/bin/git commit -m "fix(x): y"`],
    [
      "a quiet commit on a quiet line after a reader",
      `grep -q x /dev/null; git commit -m "fix(x): y"`,
    ],
  ])("%s runs from the home and the data folder", async (_, command) => {
    for (const cwd of homes) expect(await at(command, cwd)).toBeUndefined()
  })

  test.each([
    ["ls of a glob", "ls *.md"],
    ["grep through a glob", "grep -n foo src/*.ts"],
    ["git add of a glob", "git add docs/*.md"],
    ["cat of a brace", "cat {a,b}.txt"],
    ["rm of a glob outside the root", "rm -f build/*.tmp"],
    ["grep of spaced text through a glob", "grep -rn 'foo bar' docs/*.md"],
    ["cp of a glob into a spaced folder", "cp docs/*.md 'out dir'"],
    ["a glob listing, then awk", "ls *.md; awk '{print $1}' f"],
    ["an unknown variable set, then awk", "x=\"$1\"; awk '{print $1}' f"],
    ["find running grep on spaced text", "find . -name '*.ts' -exec grep -l 'foo bar' {} +"],
    ["awk over each file of a glob", "for f in *.md; do awk '/sh -c/ {print}' \"$f\"; done"],
    [
      "a git call given an unread word, then a plain commit",
      "git log \"$REV\"; git commit -m 'fix(x): y'",
    ],
    ["a word piped to a root shell", "echo hi | sudo -s"],
    ["a listing piped to a root shell", "echo 'ls -la' | sudo -s"],
    ["a root shell given its command", "sudo -s ls"],
    [
      "sudo with a flag cluster holding a value option",
      "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -ui",
    ],
  ])("%s runs from a worktree", async (_, command) => {
    expect(await at(command, join(homedir(), "x", ".claude", "worktrees", "y"))).toBeUndefined()
  })

  test.each([
    ["rm of mktemp's folder", 'T=$(mktemp -d); rm -rf "$T"'],
    ["rm of mktemp's quiet folder", 'T="$(mktemp -dq)"; rm -rf "$T"'],
    ["rm of mktemp's file", 'F=$(mktemp); rm -f "$F"'],
    ["rm of a pid-named temporary file", "rm -f /tmp/x.$$"],
    ["rm of mktemp's folder from a literal template", 'T=$(mktemp -d /tmp/x.XXXX); rm -rf "$T"'],
    [
      "rm of mktemp's folder from a held variable's template",
      'D=/tmp/w; T=$(mktemp -d "$D/x.XXXX"); rm -rf "$T"',
    ],
  ])("%s runs from the home with TMPDIR set", async (_, command) => {
    const env = { HOME: homedir(), TMPDIR: tmpdir() }
    const raw = JSON.stringify({ cwd: homedir(), tool_input: { command }, tool_name: "Bash" })
    expect(await check(raw, env)).toBeUndefined()
  })

  test("the dispatcher brief's call that finds the Dashboard's checkout runs from a worktree", async () => {
    const step = readFileSync(
      join(import.meta.dir, "../../../scripts/briefs/dispatcher.md"),
      "utf8",
    )
      .split("\n")
      .find((line) => line.startsWith("2. "))
    const spans = [...(step ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1])
    const call = ['R="', "curl ", "bun run --cwd "]
      .map((start) => spans.find((span) => span.startsWith(start)))
      .join("; ")
    expect(call).toContain("worktree list")
    expect(await at(call, join(homedir(), "x", ".claude", "worktrees", "y"))).toBeUndefined()
  })

  test.each([
    [
      "awk printing into the root",
      `awk '{print > "${join(homedir(), ".playground", "extensions", "x")}"}' /dev/null`,
    ],
    [
      "awk's system() naming the root",
      `awk 'BEGIN{system("touch ${join(homedir(), ".playground", "extensions", "x")}")}'`,
    ],
    ["touch in the root by ~", "touch ~/.playground/extensions/x"],
    [
      "awk's system() removing a path in the root",
      `awk 'BEGIN{system("rm -rf ~/.playground/extensions/.no-such-folder")}'`,
    ],
    [
      "awk printing into a command removing a path in the root",
      `awk 'BEGIN{print "x" | "rm -rf ~/.playground/extensions/.no-such-folder"}'`,
    ],
    [
      "awk reading a command removing a path in the root",
      `awk 'BEGIN{"rm -rf ~/.playground/extensions/.no-such-folder" | getline}'`,
    ],
    [
      "awk writing a removal into a git hook",
      `awk 'BEGIN{print "rm -rf ~/.playground/extensions/.no-such-folder" > ".git/hooks/pre-commit"}'`,
    ],
    [
      "awk's system() of a -v value removing a path in the root",
      "awk -v c='rm -rf ~/.playground/extensions/.no-such-folder' 'BEGIN{system(c)}'",
    ],
    [
      "gawk's system() removing a path in the root",
      `gawk 'BEGIN{system("rm -rf ~/.playground/extensions/.no-such-folder")}'`,
    ],
    [
      "nawk's system() removing a path in the root",
      `nawk 'BEGIN{system("rm -rf ~/.playground/extensions/.no-such-folder")}'`,
    ],
    [
      "sed's e command removing a path in the root",
      "sed 'e rm -rf ~/.playground/extensions/.no-such-folder' /dev/null",
    ],
    [
      "sed's addressed e command removing a path in the root",
      "sed '1e rm -rf ~/.playground/extensions/.no-such-folder' /dev/null",
    ],
    [
      "gsed's e command removing a path in the root",
      "gsed '1e rm -rf ~/.playground/extensions/.no-such-folder' /dev/null",
    ],
    [
      "awk's output sorted into a git hook by sort -o",
      "awk '$3 ~ /runner/' /dev/null | sort -o .git/hooks/pre-commit",
    ],
    [
      "awk's output written into a git hook by uniq's second file",
      "awk '$3 ~ /runner/' /dev/null | uniq - .git/hooks/pre-commit",
    ],
    [
      "awk's output sorted through a compress program",
      "awk '$3 ~ /runner/' /dev/null | sort --compress-program=sh",
    ],
    [
      "awk's output sorted into a git hook by an abbreviated --out",
      "awk '$3 ~ /runner/' /dev/null | sort --out=.git/hooks/pre-commit",
    ],
    [
      "awk's output sorted through an abbreviated --comp",
      "awk '$3 ~ /runner/' /dev/null | sort --comp=sh",
    ],
    [
      "a script named awk in the folder given a removal",
      "./awk 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a script named awk by a relative path given a removal",
      "bin/awk 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "awk run with PATH set in the call",
      "PATH=. awk 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "cut given a removal in a subshell",
      "( cut 'rm -rf ~/.playground/extensions/.no-such-folder' )",
    ],
    [
      "awk named as /usr/bin/time -o's output file, running watch",
      "/usr/bin/time -o awk watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "awk named as sudo --prompt's value, running watch",
      "sudo --prompt awk watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "cut under time, given watch and a removal",
      "time cut watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "sort under nohup, given watch and a removal",
      "nohup sort watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "uniq under exec, given watch and a removal",
      "exec uniq watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "awk after a sed, which keeps canary's reading",
      "sed -n '/sh -c/p' /dev/null; awk '$3 ~ /runner/' /dev/null",
    ],
    [
      "sed -i '' inserting a removal into a git hook",
      "sed -i '' '1i\\\nrm -rf ~/.playground/extensions/.no-such-folder' .git/hooks/pre-commit",
    ],
    [
      "sed -i '' appending a removal to a git hook",
      "sed -i '' '$a\\\nrm -rf ~/.playground/extensions/.no-such-folder' .git/hooks/pre-commit",
    ],
    [
      "sed -i '' prefixing a removal in a git hook",
      "sed -i '' 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
    ],
    [
      "sed -i prefixing a removal in a git hook",
      "sed -i 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
    ],
    [
      "sed -i.bak prefixing a removal in a git hook",
      "sed -i.bak 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
    ],
    [
      "sed --in-place prefixing a removal in a git hook",
      "sed --in-place 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
    ],
    [
      "sed --in-place= with a suffix prefixing a removal in a git hook",
      "sed --in-place=.bak 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
    ],
    [
      "sed -ni prefixing a removal in a git hook",
      "sed -ni 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |p' .git/hooks/pre-commit",
    ],
    [
      "sed -Ei prefixing a removal in a git hook",
      "sed -Ei 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
    ],
    [
      "sed with a trailing -i prefixing a removal in a git hook",
      "sed 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit -i",
    ],
    [
      "gsed -i prefixing a removal in a git hook",
      "gsed -i 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
    ],
    [
      "/usr/bin/sed -i prefixing a removal in a git hook",
      "/usr/bin/sed -i '' 's|^|rm -rf ~/.playground/extensions/.no-such-folder; |' .git/hooks/pre-commit",
    ],
    [
      "sed's w command writing into the root",
      `sed 'w ${join(homedir(), ".playground", "extensions", "x")}' /dev/null`,
    ],
    [
      "sed's s///w flag writing into the root",
      `sed 's/a/b/w ${join(homedir(), ".playground", "extensions", "x")}' /dev/null`,
    ],
    [
      "watch removing a path in the root",
      "watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "watch removing by a glob in the data folder",
      "watch 'rm -rf ~/.playground/ext*/.no-such-folder'",
    ],
    [
      "watch with an unknown word ahead of rm",
      "watch '$3 rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "watch running the home, its substitution removing a path in the root",
      "watch '~ $(rm -rf ~/.playground/extensions/.no-such-folder)'",
    ],
    [
      "a git alias removing a path in the root",
      "git -c alias.x='!rm -rf ~/.playground/extensions/.no-such-folder' x",
    ],
    ["a git alias running its argument on the home", "git -c alias.x='!$1 ~' x rm"],
    [
      "git config setting an alias that removes a path in the root",
      "git config alias.x '!rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "ssh's ProxyCommand touching the root",
      "ssh -o ProxyCommand='touch ~/.playground/extensions/x' h",
    ],
    [
      "tmux's command removing a path in the root",
      "tmux new-session 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "rsync's -e removing a path in the root",
      "rsync -e 'rm -rf ~/.playground/extensions/.no-such-folder' a b",
    ],
    [
      "find's -exec removing a path in the root",
      "find . -exec sh -c 'rm -rf ~/.playground/extensions/.no-such-folder' \\;",
    ],
    [
      "GIT_SSH_COMMAND removing a path in the root",
      "GIT_SSH_COMMAND='rm -rf ~/.playground/extensions/.no-such-folder' git fetch",
    ],
    [
      "a git alias evaluating the word after -m",
      `git -c alias.x='!eval "$2"' x -m 'rm -rf ~/.playground/extensions/.no-such-folder'`,
    ],
    [
      "a git alias's sh -c running the word after -m",
      `git -c alias.x='!sh -c "$2"' x -m 'rm -rf ~/.playground/extensions/.no-such-folder'`,
    ],
    [
      "a git alias from the environment running the word after -m behind --attr-source commit",
      `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.x GIT_CONFIG_VALUE_0='!eval "$2"' git --attr-source commit x -m 'rm -rf ~/.playground/extensions/.no-such-folder'`,
    ],
    [
      "a commit message under a call that sets config",
      "git -c x.y=z commit -m 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "screen's shell removing a path in the root",
      "screen -dm sh -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "flock's shell removing a path in the root",
      "flock /tmp/l sh -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    ["a shell held in a variable", "S=sh; $S -c 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    ["the user's shell", "$SHELL -c 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    ["ssh held in a variable", "x=ssh; $x host 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    [
      "watch held in a loop variable",
      "for p in watch; do $p 'rm -rf ~/.playground/extensions/.no-such-folder'; done",
    ],
    ["a shell in capitals", "SH -c 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    ["watch with a capital", "Watch 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    [
      "git in capitals running an alias",
      "GIT -c alias.x='!rm -rf ~/.playground/extensions/.no-such-folder' x",
    ],
    ["taskpolicy's shell", "taskpolicy -b sh -c 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    ["lockf's shell", "lockf -t0 /tmp/l sh -c 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    ["watch through bun x", "bun x watch 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    [
      "a shell through pnpm exec",
      "pnpm exec sh -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    ["eval through setsid", "setsid eval 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    ["ssh through sshpass", "sshpass -p x ssh h 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    [
      "scp's ProxyCommand removing a path in the root",
      "scp -o ProxyCommand='rm -rf ~/.playground/extensions/.no-such-folder' a h:b",
    ],
    ["a shell named by a ? glob", "/bin/s? -c 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    [
      "a shell named by a bracket glob",
      "/bin/[s]h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a shell and its -c from a brace",
      "{sh,-c} 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a shell from a brace with an empty member",
      "{sh,} -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a globbed shell behind taskpolicy",
      "taskpolicy -b /bin/s? -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    ["a braced shell behind env", "env {sh,-c} 'rm -rf ~/.playground/extensions/.no-such-folder'"],
    [
      "a braced shell in bash -c's script",
      `bash -c "{sh,-c} 'rm -rf ~/.playground/extensions/.no-such-folder'"`,
    ],
    [
      "a shell named by a POSIX class",
      "/bin/[[:alpha:]]h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a shell named by a brace range",
      "/bin/{r..t}h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a shell named by an extglob",
      "/bin/@(sh) -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a shell named by a leading star",
      "/bin/*h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a shell from a brace inside the name",
      "{s,}h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a copy of a shell named by a glob",
      "./x? -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a star-named shell behind taskpolicy",
      "taskpolicy -b /bin/*h -c 'rm -rf ~/.playground/extensions/.no-such-folder'",
    ],
    [
      "a function that evals its arguments",
      `f() { eval "$@"; }; f 'rm -rf ~/.playground/extensions/.no-such-folder'`,
    ],
    [
      "a function that runs its argument by sh -c",
      `f() { sh -c "$1"; }; f 'rm -rf ~/.playground/extensions/.no-such-folder'`,
    ],
    [
      "a function by the function keyword",
      `function f { eval "$@"; }; f 'rm -rf ~/.playground/extensions/.no-such-folder'`,
    ],
    ["a gated message under git in capitals", "GIT commit -m 'docs: playground ext sync'"],
    ["a gated message under Git", "Git commit -m 'docs: playground ext sync'"],
    [
      "a payload set as an argument, then evaluated",
      `set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; eval "$1"`,
    ],
    [
      "a payload set as an argument, then run by bash -c",
      `set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; bash -c "$1"`,
    ],
    [
      "a payload set as an argument, then run by ssh",
      `set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; ssh h "$1"`,
    ],
    [
      "a payload set as an argument, then run by watch",
      `set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; watch "$1"`,
    ],
    [
      "a payload set as an argument, then run by the user's shell",
      `set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; "$SHELL" -c "$1"`,
    ],
    [
      "a payload held in the last argument",
      `true 'rm -rf ~/.playground/extensions/.no-such-folder'; eval "$_"`,
    ],
    [
      "a payload held by getopts",
      `getopts x o 'rm -rf ~/.playground/extensions/.no-such-folder'; eval "$o"`,
    ],
    [
      "a payload set in bash -c's script, then evaluated",
      `bash -c 'set -- "rm -rf ~/.playground/extensions/.no-such-folder"; eval "$1"'`,
    ],
    [
      "a commit message run by eval through $_",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; eval \"$_\"",
    ],
    [
      "a commit message run by eval through git log",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder' && eval \"$(git log -1 --format=%s)\"",
    ],
    [
      "a commit message run by sh -c through git log",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; sh -c \"$(git log -1 --format=%s)\"",
    ],
    [
      "a tag message run by eval through git tag",
      "git tag -m 'rm -rf ~/.playground/extensions/.no-such-folder' v1; eval \"$(git tag -l --format='%(contents)' v1)\"",
    ],
    [
      "a commit message piped into sh",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | sh",
    ],
    [
      "a commit message run through xargs and sh -c",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | xargs -I{} sh -c '{}'",
    ],
    [
      "a payload held in an array",
      `args=('rm -rf ~/.playground/extensions/.no-such-folder'); sh -c "\${args[0]}"`,
    ],
    [
      "a commit message sourced through process substitution",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; source <(git log -1 --format=%s)",
    ],
    [
      "a commit message fed to sh as a here-string",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; sh <<< \"$(git log -1 --format=%s)\"",
    ],
    [
      "a commit message sourced from stdin",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; . /dev/stdin <<< \"$(git log -1 --format=%s)\"",
    ],
    [
      "a commit message written to a script sh runs",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s > f.sh; sh f.sh",
    ],
    [
      "a commit message run as a substitution",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; $(git log -1 --format=%s)",
    ],
    [
      "a commit message run through a variable",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; x=$(git log -1 --format=%s); $x",
    ],
    [
      "a commit message piped into a glob program",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | /bin/s?",
    ],
    [
      "a commit message piped into ssh",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | ssh h",
    ],
    [
      "a commit message piped into ssh's sh",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | ssh h sh",
    ],
    [
      "a commit message piped into watch's sh",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | watch -x sh",
    ],
    [
      "an argument fed to sh as a here-string through $_",
      "true 'rm -rf ~/.playground/extensions/.no-such-folder'; sh <<< \"$_\"",
    ],
    [
      "an argument sourced through $_",
      "true 'rm -rf ~/.playground/extensions/.no-such-folder'; source <(echo \"$_\")",
    ],
    [
      "a positional fed to sh as a here-string",
      "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; sh <<< \"$1\"",
    ],
    [
      "a positional piped into a glob program",
      "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; echo \"$1\" | /bin/s?",
    ],
    [
      "a positional piped into ssh",
      "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; echo \"$1\" | ssh h",
    ],
    [
      "a positional run as a command",
      "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; $1",
    ],
    [
      "a positional written to a script sh runs",
      "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; echo \"$1\" > f.sh; sh f.sh",
    ],
    [
      "a commit message run by a stored git alias through $_",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git x \"$_\"",
    ],
    [
      "a commit message run by git rebase -x",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git rebase -x \"$_\" HEAD~1",
    ],
    [
      "a commit message run by git rebase --exec",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git rebase --exec \"$_\" HEAD~1",
    ],
    [
      "a commit message run by git bisect run",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git bisect run \"$_\"",
    ],
    [
      "a commit message run by git submodule foreach",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git submodule foreach \"$_\"",
    ],
    [
      "a commit message run by git filter-branch",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git filter-branch -f --tree-filter \"$_\" HEAD",
    ],
    [
      "a commit message run by git difftool -x",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git difftool -y -x \"$_\" HEAD~1",
    ],
    [
      "a positional run by git rebase -x",
      "set -- 'rm -rf ~/.playground/extensions/.no-such-folder'; git rebase -x \"$1\" HEAD~1",
    ],
    [
      "an argument run by git submodule foreach",
      "true 'rm -rf ~/.playground/extensions/.no-such-folder'; git submodule foreach \"$_\"",
    ],
    [
      "a commit message run by a stored git alias with no argument",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git x",
    ],
    [
      "a commit message xargs hands git rebase -x",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | xargs -I{} git rebase -x {} HEAD~1",
    ],
    [
      "a commit message xargs hands git submodule foreach",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | xargs git submodule foreach",
    ],
    [
      "a commit message written to a script git rebase -x runs",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s > .git/x.sh; git rebase -x 'sh .git/x.sh' HEAD~1",
    ],
    [
      "a commit message written to a script git submodule foreach runs",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s > f.sh; git submodule foreach 'sh f.sh'",
    ],
    [
      "a commit message piped into git submodule foreach's sh",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | git submodule foreach sh",
    ],
    [
      "a commit message piped into git submodule foreach's sh -s",
      "git commit --allow-empty -m 'rm -rf ~/.playground/extensions/.no-such-folder'; git log -1 --format=%s | git submodule foreach 'sh -s'",
    ],
  ])("%s stays refused", async (_, command) => {
    for (const cwd of [...homes, join(homedir(), "x", ".claude", "worktrees", "y")])
      expect(await at(command, cwd)).toContain("no-extensions-write hook refuses")
  })

  test("a refusal names a program it cannot read as such", async () => {
    expect(await at("git -c alias.x='!$1 ~' x rm", homedir())).toContain(
      "refuses a program it cannot read on",
    )
  })

  test.each([
    ["a glob of the data folder", "rm -rf .pl*", HOME],
    ["a brace of the data folder", "rm -rf {.playground,x}", HOME],
    ["a zsh group of the data folder", "rm -rf (.playground|x)", HOME],
    ["a zsh qualifier on every folder", "rm -rf *(/)", HOME],
    ["a glob through a link to the data folder", "rm -rf p*/extensions/x", HOME],
    ["bash's extglob @() of the data folder", "shopt -s extglob; rm -rf @(.playground)", HOME],
    ["bash's extglob +() of the data folder", "shopt -s extglob; rm -rf +(.playground)", HOME],
    ["bash's extglob ?() of the data folder", "shopt -s extglob; rm -rf ?(.playground)", HOME],
    ["bash's extglob !() of every other name", "shopt -s extglob; rm -rf !(x)", HOME],
    ["rm of a glob through a link to the root", "rm -rf s*/", DATA],
    ["a redirect through a glob of a link to the root", "echo x > s*/policy.json", DATA],
    ["a glob climbing back out to the data folder", "rm -rf w*/../.p*", HOME],
    [
      "a redirect climbing back out into the root",
      "echo x > w*/../.playground/extension?/policy.json",
      HOME,
    ],
    ["a glob in the data folder climbing to the root", "rm -rf .playground/h*/../e*", HOME],
    ["a glob climbing to the root from the data folder", "rm -rf h*/../e*", DATA],
    ["a glob climbing out to any other folder", "rm -rf w*/../Documents/x", HOME],
    ["a glob past a link and its `..`", "rm -rf store/../e*", HOME],
    ["a redirect to a glob no entry matches", "echo x > q*", DATA],
    ["rm of a glob no entry matches", "rm -rf q*", HOME],
  ])("%s stays refused, as every glob above the root is", async (_, command, cwd) => {
    expect(await bash(command, cwd)).toContain("no-extensions-write hook refuses")
  })

  test.each([
    [
      "git config set in the call, dropping its -c guard runs it",
      `git -c x.y=z commit -m "fix(x): y"`,
    ],
    [
      "a runner on the line, dropping its quiet-line guard runs it",
      `git commit -m "fix(x): y"; sh -c 'true'`,
    ],
    [
      "a redirect that writes a file, dropping its redirect guard runs it",
      `git commit -m "fix(x): y" > f`,
    ],
    [
      "a message naming a gated call, dropping its message guard runs it",
      `git commit -m "docs: the hook refuses playground ext sync now"`,
    ],
    [
      "a message holding the root's path as text, dropping its text guard runs it",
      `git commit -m "see ${join(homedir(), ".playground", "extensions")} now"`,
    ],
    [
      "a globbing file name after -F, which names a file not a held message",
      `git commit -F "my(x) file"`,
    ],
    [
      "a globbing name after --template, which names a file not a held message",
      `git commit --template "t(x) pl"`,
    ],
    [
      "a commit relocated by git -C, dropping its global guard runs it",
      `git -C /tmp commit -m "fix(x): y"`,
    ],
    [
      "a commit relocated by --git-dir, dropping its global guard runs it",
      `git --git-dir=/tmp/.git commit -m "fix(x): y"`,
    ],
    [
      "a commit relocated by --work-tree, dropping its global guard runs it",
      `git --work-tree=/tmp commit -m "fix(x): y"`,
    ],
  ])(
    "a git commit the hook does not read as text stays refused from the home: %s",
    async (_, command) => {
      for (const cwd of homes)
        expect(await at(command, cwd)).toContain("no-extensions-write hook refuses")
    },
  )

  test.each([
    "sudo git",
    "sudo -u x git",
    "doas git",
    "env git",
    "env -i git",
    "env -S 'git'",
    "xargs git",
    "nice git",
    "nice -n 5 git",
    "nohup git",
    "timeout 5 git",
    "time git",
    "stdbuf -o0 git",
    "caffeinate git",
    "command git",
    "builtin git",
    "exec git",
    "./git",
    "bin/git",
    "~/bin/git",
    "/tmp/x/git",
  ])(
    "a quiet message on %s, a program narrow() would not read, keeps canary's refusal",
    async (program) => {
      for (const cwd of homes)
        expect(await at(`${program} commit -m "fix(x): y"`, cwd)).toContain(
          "no-extensions-write hook refuses",
        )
    },
  )
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
    ["a glob elsewhere", "rm -rf /tmp/scratch-dir/*"],
    ["a printer naming the root", `echo ${ROOT}`],
    ["tr with a bare slash", "tr / _ < /tmp/x"],
    ["rg naming the CLI's words", "rg playground settings"],
    ["grep naming a gated call", `grep -rn "playground ext sync" docs`],
    ["echo naming a gated call", "echo playground ext sync"],
    ["a default in ${X:-…}", "echo ${X:-default}"],
    ["bash reading a process substitution that writes elsewhere", "bash <(echo ls /tmp)"],
    ["git log with a pager", "GIT_PAGER=cat git log"],
    ["git -c of a name", "git -c user.name=x commit -m y"],
    ["a commit message naming ext sync", `git commit -m "fix: read ext sync forms"`],
    [
      "a comment naming a settings set no guard reads",
      `gh pr comment 1 --body "run playground settings set ui.theme dark"`,
    ],
    ["rg of a gated call", "rg 'playground ext sync'"],
    ["cat of two 900 KB files into one elsewhere", `cat ${BIG[0]} ${BIG[1]} > /tmp/nxw-all`],
    ["rg with --pre-glob alone", "rg --pre-glob '*.gz' x /tmp"],
    ["a git author name with a space", "GIT_AUTHOR_NAME='A B' git log"],
    ["a pager with an option", "GIT_PAGER='less -R' git log"],
    ["a commit message with an unbalanced quote", `git commit -m "it's fine"`],
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
    [
      "ext put by bun on the installed link",
      "bun ~/.bun/bin/playground ext put login list x /tmp/l.json --reason y",
    ],
    [
      "ext put by bun --cwd to its folder",
      `bun --cwd ${CLI_DIR} cli.ts ext put login list x /tmp/l.json --reason y`,
    ],
    [
      "ext put by bun on cli with no extension",
      `bun ${CLI_DIR}/cli ext put login list x /tmp/l.json --reason y`,
    ],
    [
      "ext put by cli.ts run directly",
      `${CLI_DIR}/cli.ts ext put login list x /tmp/l.json --reason y`,
    ],
    [
      "ext put by bun past --preload",
      `bun --preload /tmp/x.ts ${CLI_DIR}/cli.ts ext put login list x /tmp/l.json --reason y`,
    ],
    [
      "ext put past a word it cannot read",
      'playground ext put "$(printf -- --dry-run)" login list x /tmp/x.json --reason r',
    ],
    [
      "settings set past --yes, which settings takes as an option",
      `playground settings set --yes ui.theme owner.names '["x"]' --reason r`,
    ],
    [
      "settings reset past --yes",
      "playground settings reset --yes ui.theme owner.names --reason r",
    ],
    ["settings set of live.branch", "playground settings set live.branch x --reason r"],
    ["settings set of paths.codeRoot", "playground settings set paths.codeRoot / --reason r"],
    ["settings set of sessions.names", "playground settings set sessions.names '{}' --reason r"],
    [
      "settings set of sessions.aliases",
      "playground settings set sessions.aliases '{}' --reason r",
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

  test.each([
    [
      "ext put by bun cli.ts in its folder",
      "bun cli.ts ext put login list x /tmp/l.json --reason y",
      CLI_DIR,
    ],
    [
      "ext put by bun ./cli.ts in its folder",
      "bun ./cli.ts ext put login list x /tmp/l.json --reason y",
      CLI_DIR,
    ],
    [
      "ext put by ./cli.ts in its folder",
      "./cli.ts ext put login list x /tmp/l.json --reason y",
      CLI_DIR,
    ],
    [
      "ext put by bun run from the checkout",
      "bun run packages/scripts/src/playground/cli.ts ext put login list x /tmp/l.json --reason y",
      CHECKOUT,
    ],
  ])("%s", async (_, command, cwd) => {
    expect(await bash(command, cwd)).toContain("no-extensions-write hook refuses")
  })
})

describe("a factory session's ext accept is refused, since accepting a proposal is the owner's own call", () => {
  test.each([
    ["ext accept", "playground ext accept login rule x abc --reason ok"],
    ["ext accept --by owner", "playground ext accept login rule x abc --reason ok --by owner"],
    ["ext accept past an option", "playground ext accept --reason ok login rule x abc"],
    [
      "ext accept with the role cleared",
      "PLAYGROUND_ROLE= playground ext accept login rule x abc --reason ok",
    ],
    [
      "ext accept behind env -u",
      "env -u PLAYGROUND_ROLE playground ext accept login rule x abc --reason ok",
    ],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toContain(
      "refuses playground ext accept, the owner's own call, which the owner runs as `! env -u PLAYGROUND_ROLE playground ext accept …`",
    )
  })
})

describe("git's global options before a push keep a bare push's verdict", () => {
  test.each([
    ["the data folder", DATA],
    ["the home folder", HOME],
  ])("from %s", async (_, cwd) => {
    for (const command of [
      "git push",
      "git --attr-source HEAD push",
      "git -c k=v push",
      "git -C /usr push",
    ])
      expect(await bash(command, cwd)).toBeUndefined()
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
    [
      "ext score behind env -u of another variable",
      "env -u HOME playground ext score login doc x abc 5 --reason ok",
    ],
    [
      "ext score with another data folder variable",
      "TZ=UTC playground ext score login doc x abc 5 --reason ok",
    ],
    ["ext list behind env -u of the role", "env -u PLAYGROUND_ROLE playground ext list"],
    ["ext show behind env -i", "env -i playground ext show login list release-owners"],
    [
      "ext search after the role is exported empty",
      "export PLAYGROUND_ROLE=; playground ext search x",
    ],
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
  test("a check in its Worker answers as the check does", async () => {
    const raw = JSON.stringify({
      cwd: HOME,
      tool_input: { command: `rm ${LIST}` },
      tool_name: "Bash",
    })
    expect(await guarded(raw, ENV)).toBe(await check(raw, ENV))
    const read = JSON.stringify({
      cwd: HOME,
      tool_input: { command: `cat ${LIST}` },
      tool_name: "Bash",
    })
    expect(await guarded(read, ENV)).toBeUndefined()
  })

  test("a single step the deadline cannot interrupt is refused when the main thread's timer fires", async () => {
    const command = `printf '%s${",".repeat(60)}' '{' ${"x ".repeat(6_000)}| xargs -I @ watch '@ a'; playground ext import x`
    const raw = JSON.stringify({ cwd: "/tmp", tool_input: { command }, tool_name: "Bash" })
    const started = performance.now()
    expect(await guarded(raw, ENV, 1_000)).toContain("split it into shorter calls")
    expect(performance.now() - started).toBeLessThan(3_000)
  })

  test("a check that never answers is refused when the main thread's timer fires", async () => {
    const busy = new URL("./fixtures/busy-worker.ts", import.meta.url).href
    const started = performance.now()
    const reason = await guarded("{}", ENV, 300, busy)
    expect(reason).toContain("split it into shorter calls")
    expect(performance.now() - started).toBeLessThan(2_000)
  })

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

// Every settings key a hook (and the helper no-public-leak reads its repos through) names is gated, so a guard that starts reading a new key fails here until it joins GUARD_KEYS; spawn.sh's code root is pinned by name.
describe("the gated keys are every key the guards read", () => {
  const read = async (path: string) => Bun.file(join(CHECKOUT, path)).text()
  const defined = async () => {
    const keys = new Set<string>()
    for await (const file of new Bun.Glob("packages/settings/src/*.ts").scan(CHECKOUT))
      for (const m of (await read(file)).matchAll(/^ {2}"([a-z]+\.[A-Za-z0-9]+)": \{/gm))
        keys.add(m[1]!)
    return keys
  }

  test("each key a hook names is gated", async () => {
    const keys = await defined()
    expect(keys.size).toBeGreaterThan(20)
    const files = [
      ...(await Array.fromAsync(new Bun.Glob("scripts/hooks/*.ts").scan(CHECKOUT))),
      "packages/scripts/src/trace-count/kinds.ts",
    ].filter((file) => !file.endsWith("no-extensions-write.ts"))
    const named: string[] = []
    for (const file of files) {
      const text = await read(file)
      for (const key of keys) if (text.includes(`"${key}"`)) named.push(`${file}: ${key}`)
    }
    expect(named.length).toBeGreaterThan(5)
    expect(named.filter((hit) => !GUARD_KEYS.has(hit.split(": ")[1]!))).toEqual([])
  })

  test("ext.order, which orders the extensions every guard reads, is gated", async () => {
    expect(await read("packages/settings/src/settings.ts")).toContain('values["ext.order"]')
    expect(GUARD_KEYS.has("ext.order")).toBe(true)
  })

  test("spawn.sh's code root is gated", async () => {
    expect(await read("scripts/spawn.sh")).toContain("setting_text paths.codeRoot")
    expect(GUARD_KEYS.has("paths.codeRoot")).toBe(true)
  })
})

describe("a refusal for a value the hook does not hold names it in readable text", () => {
  test.each([
    ["a variable", "rm -f $X/x", "rm on $X/x,"],
    ["a loop variable", 'for d in a b; do rm -f "$d/x"; done', 'rm on "$d/x",'],
    ["a variable inside a nested shell's script", 'bash -c "rm -f $X/x"', "rm on $…/x,"],
  ])("%s", async (_, command, named) => {
    const reason = await bash(command, "/tmp")
    expect(reason).toContain(named)
    expect(reason).not.toContain("\u0000")
  })
})
