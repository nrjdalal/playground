import type { Group, Row } from "./_shared"

// #2372: a portless proxy stop with no port, or a port flag that carries no number, which portless 0.15.11 answers by probing 443, 80 and 1355 and stopping whichever proxy answers (cli.js:2121), the live one every worktree routes through; rows are data, as refused-forms.ts says.
const held = (): Row[] => [
  ["a proxy stop by portless with no port", "portless proxy stop"],
  ["a proxy stop by bunx with no port", "bunx portless proxy stop"],
  ["a proxy stop by npx with its own flag and no port", "npx -y portless proxy stop"],
  ["a proxy stop by bun x with no port", "bun x portless proxy stop"],
  ["a proxy stop by a path to portless with no port", "./node_modules/.bin/portless proxy stop"],
  ["a proxy stop whose -p carries no number", "portless proxy stop -p"],
  [
    "a proxy stop whose --port is joined by an =, which portless does not read",
    "portless proxy stop --port=14155",
  ],
  ["a proxy stop with --help, which portless still runs as a stop", "portless proxy stop --help"],
  ["a proxy stop after a cd in a chain", "cd /tmp && bunx portless proxy stop"],
  ["a proxy stop in a shell's script", "sh -c 'bunx portless proxy stop'"],
  [
    "a proxy stop as run-slot's command",
    "~/.playground/ops/run-slot.sh w -- bunx portless proxy stop",
  ],
]

const controls = (): Row[] => [
  ["a proxy stop by portless on its own port", "portless proxy stop -p 14155"],
  ["a proxy stop by bunx on its own port, by --port", "bunx portless proxy stop --port 14155"],
  ["a proxy start on its own port", "portless proxy start -p 14155 --no-tls"],
  ["a URL read by portless", "bunx portless get api.playground"],
  ["a proxy stop as text", "echo 'portless proxy stop'"],
  ["a search for a proxy stop", 'git grep -n "portless proxy stop"'],
]

export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-kill-by-name"],
    rows: () => [...held(), ...controls()],
  },
]

export const allowed: string[] = controls().map(([what]) => what)
