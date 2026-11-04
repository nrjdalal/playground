import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
// Each removes a glob of the data folder (`~/.play*`), which rmdir leaves in place since the data folder is not empty, so a row run by mistake deletes nothing; the glob holds no literal root substring, so canary catches it only from a folder at or above the root and runs it from a worktree, which this source makes refuse everywhere.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "an inline node program removing a data-folder glob through execSync",
        `node -e 'require("child_process").execSync("rmdir ~/.play*")'`,
      ],
      [
        "an inline node program removing a data-folder glob through execSync joined from two strings",
        `node -e 'require("child_process").execSync("rmdir " + "~/.play*")'`,
      ],
      [
        "an inline node program removing a data-folder glob through exec",
        `node -e 'require("child_process").exec("rmdir ~/.play*")'`,
      ],
      [
        "an inline bun program removing a data-folder glob through spawnSync with shell true",
        `bun -e 'Bun.spawnSync("rmdir ~/.play*", { shell: true })'`,
      ],
      [
        "an inline node program removing a data-folder glob through spawn with shell true",
        `node -e 'require("child_process").spawn("rmdir ~/.play*", { shell: true })'`,
      ],
      [
        "an inline node program removing a data-folder glob through execFile with shell true",
        `node -e 'require("child_process").execFile("rmdir ~/.play*", { shell: true })'`,
      ],
    ],
  },
]
