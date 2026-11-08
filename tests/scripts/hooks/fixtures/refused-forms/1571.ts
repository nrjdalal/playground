import { type Group, NEVER_MADE } from "./_shared"

// Inside double quotes a quote in a parameter expansion is a plain character, so the command substitution past it runs, which the shared reader once read as quoted text; each guard that imports it pins the form. Rows are data, as refused-forms.ts says.
const form = (what: string, call: string) =>
  [
    `${what} past a quote inside a double-quoted parameter expansion`,
    `echo "\${X:-'$(${call})'}"`,
  ] as const

// The same call as plain text in a quoted default, with no substitution, which the shell prints and never runs.
const text = (what: string, call: string) =>
  [
    `${what} as text in a double-quoted parameter expansion's quoted default`,
    `echo "\${X:-'${call}'}"`,
  ] as const

export const groups: Group[] = [
  {
    folders: ["process home", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      form("a recursive delete", `rm -rf ${NEVER_MADE}`),
      text("the same recursive delete", `rm -rf ${NEVER_MADE}`),
    ],
  },
  {
    folders: ["checkout", "home"],
    guards: ["no-stash"],
    rows: () => [form("a stash pop", "git stash pop"), text("the same stash pop", "git stash pop")],
  },
  {
    folders: ["checkout"],
    guards: ["no-kill-by-name"],
    rows: () => [
      form("a kill by pattern", "pkill -f watcher"),
      text("the same kill by pattern", "pkill -f watcher"),
    ],
  },
  {
    folders: ["home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      form("a settings set", "playground settings set live.branch x --reason r"),
      text("the same settings set", "playground settings set live.branch x --reason r"),
    ],
  },
]

// The forms with a quote and no substitution, which run as the shell prints them.
export const allowed: string[] = [
  "the same recursive delete",
  "the same stash pop",
  "the same kill by pattern",
  "the same settings set",
].map((what) => `${what} as text in a double-quoted parameter expansion's quoted default`)
