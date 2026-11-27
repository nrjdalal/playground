import type { Group, Row } from "./_shared"

// #3186: a for loop's literal words give its variable each value in turn, so a write or a removal through it is judged under every word and a loop head names no path of its own; each loop with the root or the data folder among its words is refused, as is one over a list that expands, while its twin over two scratch folders runs; rows are data, as refused-forms.ts says.
const ROOT = "$HOME/.playground/extensions/home/x"
const DATA = "$HOME/.playground"
const A = "/tmp/pg-3186-a"
const B = "/tmp/pg-3186-b"

const writes = (words: string): Row[] => [
  ["a cp through the loop's variable", `for d in ${words}; do cp /dev/null "$d/.env"; done`],
  ["a tee through the loop's variable", `for d in ${words}; do echo x | tee "$d/.env"; done`],
  ["a redirect through the loop's variable", `for d in ${words}; do echo x > "$d/.env"; done`],
  ["a remover through the loop's variable", `for d in ${words}; do rm -f "$d/.env"; done`],
]

const root = (): Row[] => [
  ...writes(`${A} ${ROOT}`).map(([what, call]): Row => [`${what}, the root among its words`, call]),
  [
    "a remover of the data folder through the loop's variable",
    `for d in ${A} ${DATA}; do rm -f "$d"; done`,
  ],
  [
    "a cp over a list that expands",
    `for d in $(printf %s ${ROOT}); do cp /dev/null "$d/.env"; done`,
  ],
  ["a cp over a glob", `for d in ${DATA}/extensions/*; do cp /dev/null "$d/.env"; done`],
  [
    "a cp whose variable the line sets again",
    `for d in ${A}; do d=${ROOT}; cp /dev/null "$d/.env"; done`,
  ],
  ["a cp through a bare export", `export X=${ROOT}; cp /dev/null "$X/.env"`],
]

const controls = (): Row[] => [
  ...writes(`${A} ${B}`).map(([what, call]): Row => [`${what}, two scratch folders`, call]),
  [
    "a read-only loop over the data folder",
    `for d in ${A} ${DATA}; do ls -a "$d" | grep env; done`,
  ],
  ["a read-only loop over the root", `for d in ${DATA} ${ROOT}; do ls -a "$d" | grep -c x; done`],
]

export const allowed: string[] = controls().map(([what]) => what)
export const groups: Group[] = [
  {
    folders: ["data folder", "home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: root,
  },
  {
    folders: ["home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: controls,
  },
]
