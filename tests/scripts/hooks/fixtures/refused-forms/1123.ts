import { type Group, NEVER_MADE } from "./_shared"

// #1123: macOS's filesystem ignores case, so a program named in another case runs the same program, and each guard refuses it as it refuses the name in lower case; a shell builtin that changes the shell's own state keeps its case, since in another case it runs no builtin; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-raw-spawn"],
    rows: () => [
      [
        "herdr in capitals starting an agent as claude",
        "HERDR agent start probe-x --kind claude --pane w9:p9",
      ],
      ["herdr capitalised running claude in a pane", "Herdr pane run w9:p9 claude"],
      ["herdr in capitals by its path", "/opt/homebrew/bin/HERDR pane run w9:p9 claude"],
      ["herdr behind env in capitals", "ENV herdr pane run w9:p9 claude"],
      ["herdr behind command in capitals", "COMMAND herdr pane run w9:p9 claude"],
      ["herdr behind time in capitals", "TIME herdr pane run w9:p9 claude"],
      ["cmux behind nice in capitals", "NICE cmux tree"],
      [
        "claude in capitals resuming a session",
        "CLAUDE --resume 00000000-0000-0000-0000-000000000000",
      ],
    ],
  },
  {
    folders: ["checkout", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      ["a recursive delete by rm in capitals", `RM -rf ${NEVER_MADE}`],
      ["a recursive delete by rm capitalised", `Rm -rf ${NEVER_MADE}`],
      ["a recursive delete by rm in capitals by its path", `/bin/RM -rf ${NEVER_MADE}`],
      ["a recursive delete behind nice in capitals", `NICE rm -rf ${NEVER_MADE}`],
      ["a recursive delete behind command in capitals", `COMMAND rm -rf ${NEVER_MADE}`],
      ["a recursive delete behind time in capitals", `TIME rm -rf ${NEVER_MADE}`],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-stash"],
    rows: () => [
      ["a stash pop by git in capitals", "GIT stash pop"],
      ["a stash drop by git capitalised", "Git stash drop"],
      ["a stash behind nice in capitals", "NICE git stash"],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: ({ WORK }) => [
      [
        "a commit after cd in capitals, which runs no builtin and leaves the main checkout as the folder",
        `CD ${WORK} && git commit --allow-empty -m x`,
      ],
    ],
  },
]
