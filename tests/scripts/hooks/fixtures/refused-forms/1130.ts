import { type Group, NEVER_MADE } from "./_shared"

// #1130: BSD env and GNU env both read a lone `-` as -i and keep reading their options after it, so the program comes after them; rows are data, as refused-forms.ts says.
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
