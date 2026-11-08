import { type Group, NEVER_MADE, type Row } from "./_shared"

// The shell runs a command substitution or a backquoted command while it reads an unquoted heredoc's body, which the shared reader once kept as text, so every guard that imports it let the command through; each guard pins each heredoc shape, since the body is read the same way whatever strips its tabs, how many heredocs the command holds or which command or descriptor it feeds. Rows are data, as refused-forms.ts says.
const shapes = (what: string, call: string): Row[] => [
  [`${what} in an unquoted heredoc's command substitution`, `cat <<EOF\n$(${call})\nEOF`],
  [`${what} in an unquoted heredoc's backquotes`, `cat <<EOF\n\`${call}\`\nEOF`],
  [`${what} in a tab-stripped heredoc's command substitution`, `cat <<-EOF\n\t$(${call})\n\tEOF`],
  [`${what} in the second of two heredocs on one command`, `cat <<A <<B\nfirst\nA\n$(${call})\nB`],
  [`${what} in a heredoc on a descriptor other than stdin`, `cat 3<<EOF\n$(${call})\nEOF`],
  [
    `${what} in a heredoc feeding a loop`,
    `while read l; do echo "$l"; done <<EOF\n$(${call})\nEOF`,
  ],
  // round 1: a quote inside a parameter expansion is text in a body, so the substitution past it runs
  [
    `${what} past a quote inside an unquoted heredoc's parameter expansion`,
    `cat <<EOF\nA \${X:-'$(${call})'} B\nEOF`,
  ],
  [
    `${what} on the line after a parameter expansion whose quote a heredoc keeps as text`,
    `cat <<EOF\n\${X:-'}\n$(${call})\n'\nEOF`,
  ],
  [
    `${what} in an unquoted heredoc's arithmetic expansion`,
    `cat <<EOF\n$(( $(${call}) + 1 ))\nEOF`,
  ],
]

// The call behind a backslash, which keeps a dollar or a backquote literal in an unquoted body, so the line runs.
const escaped = (what: string, call: string): Row[] => [
  [
    `${what} behind an escaped dollar in an unquoted heredoc, which the shell leaves as text`,
    `cat <<EOF\n\\$(${call})\nEOF`,
  ],
  [
    `${what} between escaped backquotes in an unquoted heredoc, which the shell leaves as text`,
    `cat <<EOF\n\\\`${call}\\\`\nEOF`,
  ],
]

// The same call under a quoted delimiter, which the shell expands nothing in, so the call stays text and the line runs.
const quoted = (what: string, call: string): Row => [
  `${what} under a quoted heredoc delimiter, which the shell leaves unexpanded`,
  `cat <<'EOF'\n$(${call})\nEOF`,
]

const SETTINGS = "playground settings set live.branch x --reason r"

export const groups: Group[] = [
  {
    folders: ["process home", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      ...shapes("a recursive delete", `rm -rf ${NEVER_MADE}`),
      quoted("the same recursive delete", `rm -rf ${NEVER_MADE}`),
      ...escaped("the same recursive delete", `rm -rf ${NEVER_MADE}`),
    ],
  },
  {
    folders: ["checkout", "home"],
    guards: ["no-stash"],
    rows: () => [
      ...shapes("a stash pop", "git stash pop"),
      quoted("the same stash pop", "git stash pop"),
      ...escaped("the same stash pop", "git stash pop"),
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-kill-by-name"],
    rows: () => [
      ...shapes("a kill by pattern", "pkill -f watcher"),
      quoted("the same kill by pattern", "pkill -f watcher"),
      ...escaped("the same kill by pattern", "pkill -f watcher"),
    ],
  },
  {
    folders: ["home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => [
      ...shapes("a settings set", SETTINGS),
      [
        "a plain rm of the root in an unquoted heredoc's command substitution",
        `cat <<EOF\n$(rm ${ROOT})\nEOF`,
      ],
      quoted("the same settings set", SETTINGS),
      ...escaped("the same settings set", SETTINGS),
    ],
  },
]

// The forms the shell leaves as text, so no call runs: a quoted delimiter expands nothing in the body, and a backslash before a dollar or a backquote keeps that character literal.
export const allowed: string[] = [
  "the same recursive delete",
  "the same stash pop",
  "the same kill by pattern",
  "the same settings set",
].flatMap((what) => [
  `${what} under a quoted heredoc delimiter, which the shell leaves unexpanded`,
  `${what} behind an escaped dollar in an unquoted heredoc, which the shell leaves as text`,
  `${what} between escaped backquotes in an unquoted heredoc, which the shell leaves as text`,
])
