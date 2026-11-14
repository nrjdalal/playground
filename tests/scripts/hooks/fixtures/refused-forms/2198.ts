import type { Group, Row } from "./_shared"

// #2198: GNU xargs' input options (-d or --delimiter, -0 or --null, -a or --arg-file, each long one by a prefix GNU takes), and a short replace option at the end of a cluster of flags (BSD and GNU), so xargs fills a wrapper's name or the program with an input item the guard never read; rows are data, as refused-forms.ts says.
// Each form's {P} is the program xargs fills in and {T} its arguments.
const FORMS: [what: string, form: string][] = [
  ["split at -d's comma", "printf 'a,{P}' | xargs -d, -I cat nice cat {T}"],
  ["split at -d's comma given apart", "printf 'a,{P}' | xargs -d , -I cat nice cat {T}"],
  ["split at --delimiter='s comma", "printf 'a,{P}' | xargs --delimiter=, -I cat nice cat {T}"],
  [
    "split at --delimiter's comma given apart",
    "printf 'a,{P}' | xargs --delimiter , -I cat nice cat {T}",
  ],
  ["split at a shortened --delim='s comma", "printf 'a,{P}' | xargs --delim=, -I cat nice cat {T}"],
  ["split at -d's hex escape", "printf 'a,{P}' | xargs -d '\\x2c' -I cat nice cat {T}"],
  ["split at -d's octal escape", "printf 'a,{P}' | xargs -d '\\054' -I cat nice cat {T}"],
  ["split at -d's comma, by --replace=", "printf 'a,{P}' | xargs -d, --replace=cat nice cat {T}"],
  ["split at -0's null", "printf 'a\\0{P}' | xargs -0 -I cat nice cat {T}"],
  ["split at --null's null", "printf 'a\\0{P}' | xargs --null -I cat nice cat {T}"],
  ["split at the null of -0 in a cluster with -I", "printf 'a\\0{P}' | xargs -0I cat nice cat {T}"],
  ["read from -a's file", "echo {P} > /tmp/f; xargs -a /tmp/f -I cat nice cat {T}"],
  [
    "read from --arg-file='s file",
    "echo {P} > /tmp/f; xargs --arg-file=/tmp/f -I cat nice cat {T}",
  ],
  [
    "read from --arg-file's file given apart",
    "echo {P} > /tmp/f; xargs --arg-file /tmp/f -I cat nice cat {T}",
  ],
  [
    "read from a shortened --arg='s file",
    "echo {P} > /tmp/f; xargs --arg=/tmp/f -I cat nice cat {T}",
  ],
  ["read from -a's process substitution", "xargs -a <(echo {P}) -I cat nice cat {T}"],
  ["read from -a's file, not the pipe", "echo zz | xargs -a <(echo {P}) -I cat nice cat {T}"],
  ["read by a shortened --repl=", "echo {P} | xargs --repl=cat nice cat {T}"],
  ["read by -J at the end of a cluster with -r", "echo {P} | xargs -rJ cat cat {T}"],
  ["read by -J at the end of a cluster with -0", "printf {P} | xargs -0J cat cat {T}"],
  ["read by -I at the end of a cluster with -t", "echo {P} | xargs -tI cat nice cat {T}"],
]

const rows = (what: string, program: string, args: string): Row[] =>
  FORMS.map(([how, form]) => [
    `${what} by a program xargs puts in place of a typed word, ${how}`,
    form.replaceAll("{P}", program).replaceAll("{T}", args),
  ])

export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => rows("ext add", "playground", "ext add login list x y"),
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => rows("a build in the main checkout", "turbo", "run build"),
  },
  {
    folders: ["checkout"],
    guards: ["no-unslotted-run"],
    rows: () => rows("an unslotted build", "turbo", "run build"),
  },
]
