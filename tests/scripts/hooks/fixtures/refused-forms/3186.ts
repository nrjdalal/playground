import type { Group, Row } from "./_shared"

// #3186: a for loop's literal words give its variable each value in turn, so a write or a removal through it is judged under every word while the loop's head is judged as any program's words; each loop with the root or the data folder among its words is refused, whatever its body does with the variable, as is one over a list that expands, while its twin over two scratch folders runs; rows are data, as refused-forms.ts says.
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

// bodies that read the variable where the hook judges nothing of its own (an env prefix, an export, a shell's script), from #3247's review
const bodies: Row[] = [
  ["an env prefix through the loop's variable", "P=$d mytool"],
  ["a HOME prefix through the loop's variable", "HOME=$d mytool"],
  ["an export of the loop's variable", "export d; mytool"],
  ["a shell's script through the loop's variable", 'sh -c "echo x > $d/x"'],
  ["a shell's parameter through the loop's variable", `sh -c 'echo x > "$1"/x' _ "$d"`],
  ["a cd and a write through the loop's variable", 'cd "$d" && echo x > f'],
  ["git -C through the loop's variable", 'git -C "$d" commit -m x'],
  ["a mv through the loop's variable", 'mv /tmp/f "$d/x"'],
  ["an ln through the loop's variable", 'ln -s /tmp/f "$d/x"'],
  ["an install through the loop's variable", 'install /tmp/f "$d/x"'],
  ["a touch through the loop's variable", 'touch "$d/x"'],
  ["a mkdir through the loop's variable", 'mkdir "$d/x"'],
  ["a dd through the loop's variable", 'dd if=/dev/zero of="$d/x" count=1'],
  ["inline code through the loop's variable", `python3 -c "open('$d/x','w')"`],
  ["env -C through the loop's variable", 'env -C "$d" touch x'],
  ["tar -C through the loop's variable", 'tar -C "$d" -xf /tmp/a.tar'],
  ["an rsync through the loop's variable", 'rsync /tmp/f "$d/"'],
  ["a curl -o through the loop's variable", 'curl -o "$d/x" https://example.com'],
  ["a nested loop through the loop's variable", 'for e in x y; do cp /dev/null "$d/$e"; done'],
]

const root = (): Row[] => [
  ...writes(`${A} ${ROOT}`).map(([what, call]): Row => [`${what}, the root among its words`, call]),
  ...bodies.map(([what, body]): Row => [
    `${what}, the root its word`,
    `for d in ${ROOT}; do ${body}; done`,
  ]),
  [
    "a read-only loop over the data folder",
    `for d in ${A} ${DATA}; do ls -a "$d" | grep env; done`,
  ],
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
  [
    "a cp after a read into the variable",
    `for d in ${A} ${B}; do read d; cp /dev/null "$d/.env"; done`,
  ],
  [
    "a cp after a printf -v into the variable",
    `for d in ${A} ${B}; do printf -v d %s ${ROOT}; cp /dev/null "$d/.env"; done`,
  ],
  [
    "a cp through an inner loop with the root among its words",
    `for d in ${A} ${B}; do for e in x ${ROOT}; do cp /dev/null "$e/.env"; done; done`,
  ],
  ["the twin of an env prefix", `P=${ROOT} mytool`],
  ["the twin of an export", `export d=${ROOT}; mytool`],
  ["the twin of a shell's script", `D=${ROOT}; bash -c "echo x > $D/x"`],
]

const controls = (): Row[] => [
  ...writes(`${A} ${B}`).map(([what, call]): Row => [`${what}, two scratch folders`, call]),
  [
    "a nested loop, two scratch folders",
    `for d in ${A} ${B}; do for e in x y; do cp /dev/null "$d/$e"; done; done`,
  ],
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
