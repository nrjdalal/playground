import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { check, type Proc } from "../../../scripts/hooks/no-kill-by-name"

const root = join(import.meta.dir, "..", "..", "..")

const input = (command: string) =>
  JSON.stringify({
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: "Bash",
  })
const bash = (command: string) => check(input(command))

describe("a signal sent by name or pattern is refused, with the way out", () => {
  test.each([
    "pkill -f 'watch-ci.sh 1a2b3c4'",
    "pkill node",
    "arr=($(pkill -f node))",
    "killall node",
    "/usr/bin/pkill -9 next-server",
    "\\pkill node",
    "timeout 5 pkill node",
    "echo stopping && pkill -f dev",
    "fuser -k 3000/tcp",
    "fuser --kill 3000/tcp",
    "pkill -f command -v",
    "pkill command -v",
    "killall command -V",
    "pkill -x command -V node",
    "pgrep -f watch; kill $!",
    "kill $(pgrep -f watch)",
    'kill -9 "$(pgrep -f watch)"',
    "kill -9 `pidof node`",
    "kill $(lsof -t -i :3000)",
    "pgrep -f watch | xargs kill",
    "pgrep -f watch | xargs -I{} kill -9 {}",
    "lsof -t -i :3000 | xargs kill -9",
    "ps aux | grep node | awk '{print $2}' | xargs kill",
    "pid=$(pgrep -f watch); kill $pid",
    "sh -c 'pkill node'",
    'bash -c "kill \\$(pgrep -f watch)"',
    'xargs kill <<< "$(pgrep -f watch)"',
    "xargs kill <<< $(pgrep -f watch)",
    "cat <(pgrep -f watch) | xargs kill",
    "while read p; do kill $p; done < <(pgrep -f watch)",
    "(pgrep -f watch) | xargs kill",
    "{ pgrep -f watch; } | xargs kill",
    "pgrep -f watch | xargs -I{} sh -c 'kill {}'",
    "ps -ef | grep watch | awk '{print $2}' | xargs kill",
    "~/.playground/ops/run-slot.sh w -- pkill -f watch",
    "~/.playground/ops/run-slot.sh w -- killall node",
    "~/.playground/ops/run-slot.sh w -- kill $(lsof -ti :3000)",
    "~/.playground/ops/run-slot.sh w -- pgrep -f watch | xargs kill",
    "bash ~/.playground/ops/run-slot.sh w -- pkill node",
    "sh ~/.playground/ops/run-slot.sh w -- killall node",
    "zsh ~/.playground/ops/run-slot.sh w -- kill $(lsof -ti :3000)",
    "pgrep -f watch | xargs ~/.playground/ops/run-slot.sh w -- kill",
    "lsof -ti :3000 | xargs ~/.playground/ops/run-slot.sh w -- kill -9",
    "pgrep -f watch | xargs -n1 ~/.playground/ops/run-slot.sh w -- kill",
    "pgrep -f watch | xargs bash ~/.playground/ops/run-slot.sh w -- kill",
    "pgrep -f watch | xargs sh ~/.playground/ops/run-slot.sh w -- kill",
    "pgrep -f watch | xargs -n1 bash ~/.playground/ops/run-slot.sh w -- kill",
    "pgrep -f watch | xargs zsh ~/.playground/ops/run-slot.sh w -- kill",
    "W=w; ~/.playground/ops/run-slot.sh $W -- pkill -f watch",
  ])("%s", async (command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-kill-by-name hook refuses")
    expect(reason).toContain("TaskStop")
    expect(reason).toContain("bun run dev:stop")
    expect(reason).toContain("kill <pid>")
  })
})

describe("a kill beside a search", () => {
  test("is told to run the stop in a call of its own", async () => {
    expect(await bash("pid=$(pgrep -f watch); kill $pid")).toContain("in a Bash call of its own")
  })
})

describe("a command built from a value the reader cannot read, in a call that names a kill", () => {
  // each program word is an expansion no reading resolves, so it may be any kill (#2136)
  test.each([
    '"$X" pkill -f watch',
    '$X"" pkill -f watch',
    '"$*" pkill -f watch',
    '"${X:-}" pkill -f watch',
    '"${@:-}" pkill -f watch',
    '"$1" pkill -f watch',
    "$((0)) pkill -f watch",
    "$X''$'' pkill -f watch",
    "${X^^} pkill -f watch",
    "${#X} pkill -f watch",
    "${X:-a} pkill -f watch",
    "${X:?} pkill -f watch",
    "for s in a b; do $s pkill -f watch; done",
    "getopts ab s; $s pkill -f watch",
    "printf -v s x; $s pkill -f watch",
    // #2244: a relative glob after a cd into a folder the reader cannot read may match any file there
    'cd "$X" && pk?ll -f watch',
  ])("%s is refused", async (command) => {
    expect(await bash(command)).toContain("a command built from a value it cannot read")
  })
})

// A made-up process table: the hook (100) under its shell (90) under the session's claude (80), which runs in the pane's group (70); a Bash call's shell (4000) under that claude leads its own group, and its child 4567 leads another; another session's claude (81) has a child group 5000; group 6000's leader has exited, leaving 6001
const TABLE = new Map<number, Proc>([
  [70, { comm: "-zsh", pgid: 70, ppid: 1 }],
  [80, { comm: "/usr/local/bin/claude", pgid: 70, ppid: 70 }],
  [81, { comm: "claude", pgid: 71, ppid: 1 }],
  [90, { comm: "sh", pgid: 90, ppid: 80 }],
  [100, { comm: "bun", pgid: 90, ppid: 90 }],
  [4000, { comm: "/bin/zsh", pgid: 4000, ppid: 80 }],
  [4567, { comm: "node", pgid: 4567, ppid: 4000 }],
  [5000, { comm: "node", pgid: 5000, ppid: 81 }],
  [6001, { comm: "node", pgid: 6000, ppid: 80 }],
])
const inTable = (command: string, procs = TABLE) =>
  check(input(command), () => ({ procs, self: 100 }))

describe("a kill of a process group passes only for a group the session started", () => {
  test.each(["kill -TERM -4567", "kill -- -4567", "kill -9 -- -4000", "kill -s TERM -4567 -4000"])(
    "%s, a group under the session's claude, passes",
    async (command) => {
      expect(await inTable(command)).toBeUndefined()
    },
  )

  test.each([
    ["kill -- -70", "the pane's group, above the session"],
    ["kill -TERM -5000", "another session's group"],
    ["kill -- -6000", "a group whose leader has exited"],
    ["kill -- -80", "a group the session's claude itself would lead"],
    ["kill -TERM -4567 -5000", "an own group beside a foreign one"],
    ["kill -- -9999", "a group no process leads"],
  ])("%s, %s, is refused", async (command) => {
    expect(await inTable(command)).toContain(
      "a kill of every process, a process group or its own group",
    )
  })

  test("a group is refused when the process table cannot be read", async () => {
    expect(await inTable("kill -TERM -4567", new Map())).toContain("a process group")
  })

  test("the table is read only for a negative pid", async () => {
    let reads = 0
    const counted = () => (reads++, { procs: TABLE, self: 100 })
    await check(input("kill -9 1234"), counted)
    await check(input("kill 0"), counted)
    expect(reads).toBe(0)
    await check(input("kill -- -4567"), counted)
    expect(reads).toBe(1)
  })
})

describe("a signal to a pid you hold, and a read, pass", () => {
  test.each([
    "kill 1234",
    "kill -9 1234",
    "kill -s TERM 1234",
    "kill $!",
    "kill %1",
    "kill $(cat ops/dashboard/dashboard-web.pid)",
    'kill "$(cat .pid)"',
    "pgrep -f watch",
    "pgrep -f watch | wc -l",
    "lsof -i :3000",
    "fuser 3000/tcp",
    "ps aux | grep node",
    "echo pkill node",
    "git log --grep=pkill",
    "grep -rn killall scripts",
    "PID=$(cat x.pid); ps -p $PID >/dev/null && kill $PID",
    "sleep 60 & pid=$!; ps -p $pid; kill $pid",
    "sleep 60 & pid=$!; ps -o pid= -p $pid && kill $pid",
    "command -v pkill",
    "echo $X",
    "git log $X",
    "for f in a b; do $f --version; done",
    "if true; then for s in a; do $s pkill -f watch; done; fi",
    "for s in a; do for t in b; do $t pkill -f watch; done; done",
    "select s in a; do $s pkill -f watch; done",
    "pkill --help",
    "killall -V",
    "sleep 60 & pid=$!; ps -q $pid && kill $pid",
    "sleep 60 & pid=$!; ps --pid $pid && kill $pid",
    "sleep 60 & pid=$!; ps --quick-pid $pid && kill $pid",
    "echo 1234 | xargs kill",
    // #3123's twins: a kill by pid a wrapper, BSD -J or run-slot.sh runs from xargs' input words, split or filled, bare xargs and echo in a slot, which only echo their input, and GNU -I with no word its string, which drops its input
    "xargs nohup <<< 'kill 1234'",
    "xargs timeout 5 <<< 'kill 1234'",
    "xargs env <<< 'kill 1234'",
    "echo kill 1234 | xargs nohup",
    "xargs -I{} nohup {} 1234 <<< kill",
    "xargs <<< 'pkill node'",
    "xargs -J % nohup <<< 'kill 1234'",
    "xargs -I % nohup <<< 'pkill node'",
    "xargs ~/.playground/ops/run-slot.sh w -- <<< 'kill 1234'",
    "xargs -n2 ~/.playground/ops/run-slot.sh w -- <<< 'x y kill 1234'",
    "xargs -I{} ~/.playground/ops/run-slot.sh w -- {} 1234 <<< kill",
    "echo 1234 | xargs -J % ~/.playground/ops/run-slot.sh w -- kill %",
    "xargs ~/.playground/ops/run-slot.sh w -- echo <<< 'pkill node'",
    "~/.playground/ops/run-slot.sh w -- kill 1234",
    "~/.playground/ops/run-slot.sh w -- kill $!",
    "~/.playground/ops/run-slot.sh w -- pkill --help",
    "~/.playground/ops/run-slot.sh w -- git commit -m 'no pkill here'",
    "~/.playground/ops/run-slot.sh w -- bun run test:file tests/scripts/hooks/no-kill-by-name.test.ts",
    "~/.playground/ops/run-slot.sh w -- pgrep -f watch",
    "echo 1234 | xargs ~/.playground/ops/run-slot.sh w -- kill",
    "echo 1234 | xargs bash ~/.playground/ops/run-slot.sh w -- kill",
    "pgrep -f watch | xargs ~/.playground/ops/run-slot.sh w -- sh -c 'kill 1234'",
    "P=1234; kill $P",
    'C="kill 1234"; $C',
    "W=w; ~/.playground/ops/run-slot.sh $W -- kill 1234",
    // #2161's controls: a variable set once to one word with no later change, and one changed only after its use
    "X=a; $X pkill -f watcher",
    "X=a; $X pkill -f watcher; unset X",
    "X=a; $X pkill -f watcher; read X < /dev/null",
    // #2136's controls: a program word the reader resolves, and an expansion used only as an argument
    "C=echo; $C pkill -f watcher",
    'A=(echo pkill -f watcher); "${A[@]}"',
    'A=(agent-browser --session w); "${A[@]}" open about:blank; kill 1234',
    "S='echo pkill'; eval \"$S\"",
    "S='echo pkill'; sh -c \"$S\"",
    "for c in echo; do $c pkill -f watcher; done",
    'echo "$X" pkill',
    'kill "$PID"',
    // #2244's controls: a glob used only as an argument, a program word with no glob, a glob that matches no file, which keeps its typed word, and a glob in a quoted expansion, which the shell does not match
    "ls /usr/bin/pk?ll",
    "/usr/bin/pgrep -f watcher",
    "/no/such/folder/pk?ll -f watcher",
    'X=/usr/bin; "$X/pk?ll" -f watcher',
    // #2259's controls: a brace list or zsh group used only as an argument, a commit subject holding (…), a quoted or escaped brace the shell does not expand, and a brace list in a comment
    "ls /usr/bin/{pkill,ls}",
    "echo {a,b} && ls",
    "git commit -m 'fix(PG-1): pkill (a|b) watcher'",
    'pk"{i,x}"ll -f watcher',
    "/usr/bin/pk\\{i,x}ll -f watcher",
    "echo hi # /usr/bin/pk{i,x}ll -f watcher",
    "touch f{1..3}.txt",
    // a zsh group holding an extended glob character used only as an argument, and one in a program word that spells no kill
    "ls /usr/bin/pk(i|^x)ll",
    "/usr/bin/pg(r|^x)ep -f watcher",
    // a bare * names no program, so a case arm the reader takes for a program word passes
    'cd x && for f in *.ts; do case "$f" in *" a "*) ;; esac; done',
    // a wrapper's command option with harmless text attached, mise's after a tool, watch rerunning a harmless program, and a word that only ends in kill's name (#3111)
    "flock /tmp/l -c'echo hi'",
    "flock /tmp/l '--command=echo hi'",
    "mise x node@20 -c 'node -v'",
    "watch -n 1 date",
    "watch -x ls",
    // an x before -d turns exec on, so watch runs the one word as a program's name, which names none
    "watch -xd 'pkill node'",
    "watch -d -x 'pkill node'",
    "watch -xdn 'pkill node'",
    // -d takes the n as its value, so the 2 is the program, which names no kill
    "watch -dn 2 date",
    "echo skill",
    // #3155's twins: a kill of one pid after each signal form, a lone -1 kill reads as signal 1 with no pid, and -1 before a pid read as that signal
    "kill -TERM 1234",
    "kill -0 1234",
    "kill -n 9 1234",
    "kill -- 1234",
    "kill -1",
    "kill -1 1234",
    "kill -l",
    "kill -l 9",
    "kill -L",
    "P=1234; kill -9 $P",
    "kill $(cat /tmp/x.pid)",
    "xargs kill -9 <<< 1234",
    "echo 1234 | xargs -I{} kill -9 {}",
    "cat /tmp/x.pid | xargs kill",
    "printf '1234\\0' | xargs -0 kill -9",
    "printf '1234\\0 5678\\0' | xargs -0 kill -9",
    "echo 1234 | xargs -0 kill",
    "cat /tmp/x.pid | xargs -0 kill",
    "printf '1234,5678' | xargs -d , kill -9",
    "echo 1234 > /tmp/f; xargs -a /tmp/f kill -9",
    "xargs -a <(echo 1234) kill -9",
    "echo 1234 | xargs -a - kill -9",
    "kill -$SIG 1234",
    "kill -${SIG} 1234",
    "kill -$SIG $PID",
    "kill -9 99999",
    "kill -9 2147483647",
    "kill -9 +1234",
    // #3134's controls: refused-forms/3134.ts's pipes and escapes, each handing on a kill by pid
    "printf 'x\\nkill 1234\\n' | xargs -L1 ~/.playground/ops/run-slot.sh w --",
    "xargs -0 ~/.playground/ops/run-slot.sh w -- < <(printf 'x\\0kill 1234')",
    "printf 'x\\nkill 1234\\n' | xargs -L1 nohup",
    "printf 'x\\nkill 1234\\n' | xargs -L1 sh -c",
    "printf 'x\\nkill 1234\\n' | xargs -L1 -I{} sh -c {}",
    "xargs -0 nohup < <(printf 'x\\0kill 1234')",
    "xargs -0 sh -c < <(printf 'x\\0kill 1234')",
    "xargs -0 -I{} sh -c {} < <(printf 'x\\0kill 1234')",
    "xargs nohup <<< $'x\\nkill 1234'",
    "xargs -L1 ~/.playground/ops/run-slot.sh w -- <<< $'x\\nkill 1234'",
    "echo -e 'x\\nkill 1234' | xargs -L1 ~/.playground/ops/run-slot.sh w --",
    "xargs watch <<< 'kill 1234'",
    // the twins of 3134.ts's rows whose escape ends a word, a pid, date or kill-pid in place of the name; an ANSI-C item spelling date; and a program word whose item holds a dollar and a backtick, which xargs runs as written
    "printf 'kill\\x001234' | xargs -0 nohup",
    "printf 'kill\\n1234\\n' | xargs nohup",
    "echo -e 'kill\\t1234' | xargs nohup",
    "printf 'kill\\x201234' | xargs nohup",
    "printf 'kill\\0401234' | xargs sh -c",
    "xargs nohup <<< $'kill\\n1234'",
    "printf 'x\\0kill\\0' | xargs -0 -I{} sh -c '{} 1234'",
    "xargs -0 nohup < <(printf 'kill\\x001234')",
    "printf 'date\\nnode\\n' | xargs nohup",
    "xargs nohup <<< $'date\\nnode'",
    "xargs -0 -I{} sh -c {} < <(printf 'x\\0$'\"'\"'\\\\x64ate'\"'\"'')",
    "xargs -I{} {} node <<< '$`pkill'",
    // the twins of 3134.ts's rows whose escape spells a letter or ends a word in another pipe, kill-pid in place of the name
    "printf 'ki\\x6cl\\x001234' | xargs -0 nohup",
    "printf 'ki\\x6cl 1234' | xargs nohup",
    "xargs nohup <<< $'ki\\x6cl\\n1234'",
    "printf 'x\\0ki\\x6cl 1234' | xargs -0 -I{} sh -c {}",
    "printf 'kill\\u00201234' | xargs nohup",
    "echo -e 'kill\\x0b1234' | xargs nohup",
    "printf '%b' 'kill\\x201234' | xargs nohup",
    "printf 'kill\\x201234\\n' | xargs -I{} sh -c {}",
    "printf 'kill\\x201234' | sh",
    "printf 'kill\\x201234' | bash",
    "bash <<< $'kill\\x201234'",
  ])("%s", async (command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test("leaves another tool alone", async () => {
    const raw = JSON.stringify({
      tool_input: { file_path: "/tmp/x", content: "pkill node" },
      tool_name: "Write",
    })
    expect(await check(raw)).toBeUndefined()
  })
})
