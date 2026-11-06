import { type Group, NEVER_MADE } from "./_shared"

// #1137, scope (a): Homebrew's coreutils installs env, nice, nohup, stdbuf and timeout again as genv, gnice, gnohup, gstdbuf and gtimeout, each reading its plain name's options, so each runs the program after them; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal echoed to a shell behind genv",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | genv -u X sh",
      ],
      [
        "a removal echoed to a shell behind gnice",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | gnice -n 5 sh",
      ],
      [
        "a removal echoed to a shell behind gnohup",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | gnohup sh",
      ],
      [
        "a removal echoed to a shell behind gstdbuf",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | gstdbuf -o0 sh",
      ],
      [
        "a removal echoed to a shell behind gtimeout",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | gtimeout -k 1 5 sh",
      ],
    ],
  },
  {
    folders: ["checkout", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      [
        "a recursive delete echoed to a shell behind genv",
        `echo 'rm -rf ${NEVER_MADE}' | genv -u X sh`,
      ],
      [
        "a recursive delete echoed to a shell behind gnice",
        `echo 'rm -rf ${NEVER_MADE}' | gnice -n 5 sh`,
      ],
      [
        "a recursive delete echoed to a shell behind gnohup",
        `echo 'rm -rf ${NEVER_MADE}' | gnohup sh`,
      ],
      [
        "a recursive delete echoed to a shell behind gstdbuf",
        `echo 'rm -rf ${NEVER_MADE}' | gstdbuf -o0 sh`,
      ],
      [
        "a recursive delete echoed to a shell behind gtimeout",
        `echo 'rm -rf ${NEVER_MADE}' | gtimeout -k 1 5 sh`,
      ],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-raw-spawn"],
    rows: () => [["cmux behind gtimeout", "gtimeout 5 cmux tree"]],
  },
]
