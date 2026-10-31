import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-kill-by-name"

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
    "killall node",
    "/usr/bin/pkill -9 next-server",
    "\\pkill node",
    "timeout 5 pkill node",
    "echo stopping && pkill -f dev",
    "fuser -k 3000/tcp",
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
  ])("%s", async (command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-kill-by-name hook refuses")
    expect(reason).toContain("TaskStop")
    expect(reason).toContain("bun run dev:stop")
    expect(reason).toContain("kill <pid>")
  })
})

describe("a signal to a pid you hold, and a read, pass", () => {
  test.each([
    "kill 1234",
    "kill -9 1234",
    "kill -TERM -4567",
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
    "ps -o pid= -p 1234 && kill 1234",
    "command -v pkill",
    "pkill --help",
    "killall -V",
  ])("%s", async (command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test("a kill beside a search says to run the stop in a call of its own", async () => {
    expect(await bash("pid=$(pgrep -f watch); kill $pid")).toContain("in a Bash call of its own")
  })

  test("leaves another tool alone", async () => {
    const raw = JSON.stringify({
      tool_input: { file_path: "/tmp/x", content: "pkill node" },
      tool_name: "Write",
    })
    expect(await check(raw)).toBeUndefined()
  })
})
