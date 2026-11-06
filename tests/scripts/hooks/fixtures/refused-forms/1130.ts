import { type Group, NEVER_MADE } from "./_shared"

// #1130: a lone `-` is env's -i, and BSD env keeps reading its options after it, so the program comes after them, where GNU env ends its options there; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal echoed to a shell behind env's lone dash",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | env - sh",
      ],
      [
        "a removal echoed to a shell behind env's lone dash and an unset after it",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | env - -u X sh",
      ],
      [
        "a removal echoed to sudo's shell behind env's lone dash",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | env - sudo -s",
      ],
    ],
  },
  {
    folders: ["checkout", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      [
        "a recursive delete echoed to a shell behind env's lone dash",
        `echo 'rm -rf ${NEVER_MADE}' | env - sh`,
      ],
      [
        "a recursive delete echoed to a shell behind env's lone dash and an unset after it",
        `echo 'rm -rf ${NEVER_MADE}' | env - -u X sh`,
      ],
      [
        "a recursive delete echoed to sudo's shell behind env's lone dash",
        `echo 'rm -rf ${NEVER_MADE}' | env - sudo -s`,
      ],
    ],
  },
]
