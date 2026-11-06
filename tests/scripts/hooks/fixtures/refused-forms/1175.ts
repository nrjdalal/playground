import { type Group, NEVER_MADE } from "./_shared"

const D = `rm -rf ${NEVER_MADE}`
const SHELLS = ["bash", "sudo -s", "su"]

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "process data folder", "process home", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      ...SHELLS.flatMap((s): [string, string][] => [
        [
          `a recursive delete in a here-string on descriptor 3 duplicated onto stdin, to ${s}`,
          `${s} 3<<< '${D}' <&3`,
        ],
        [
          `a recursive delete in a here-string on descriptor 3 duplicated onto descriptor 0, to ${s}`,
          `${s} 3<<< '${D}' 0<&3`,
        ],
        [
          `a recursive delete in a here-string on a brace group around ${s}`,
          `{ ${s}; } <<< '${D}'`,
        ],
        [`a recursive delete in a here-string on a subshell around ${s}`, `( ${s} ) <<< '${D}'`],
        [
          `a recursive delete in a here-string on a loop around ${s}`,
          `while read l; do ${s}; done <<< '${D}'`,
        ],
        [
          `a recursive delete in a heredoc on a brace group around ${s}`,
          `{ ${s}; } <<'EOF'\n${D}\nEOF`,
        ],
        [
          `a recursive delete echoed by a command substitution into a here-string to ${s}`,
          `${s} <<< "$(echo ${D})"`,
        ],
        [
          `a recursive delete held in a variable the line sets, in a here-string to ${s}`,
          `S='${D}'; ${s} <<< "$S"`,
        ],
      ]),
      ["a recursive delete in a here-string to su behind pkexec", `pkexec su <<< '${D}'`],
      ["a recursive delete piped into su behind pkexec", `echo '${D}' | pkexec su`],
      ["a recursive delete in a here-string to pkexec's own root shell", `pkexec <<< '${D}'`],
      ["a recursive delete piped into pkexec's own root shell", `echo '${D}' | pkexec`],
    ],
  },
  {
    folders: ["process data folder", "process home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal in a here-string on descriptor 3 duplicated onto stdin, to bash",
        `bash 3<<< '${D}' <&3`,
      ],
      [
        "a removal in a here-string on descriptor 3 duplicated onto descriptor 0, to bash",
        `bash 3<<< '${D}' 0<&3`,
      ],
      ["a removal in a here-string on a brace group around bash", `{ bash; } <<< '${D}'`],
      ["a removal in a here-string on a subshell around bash", `( bash ) <<< '${D}'`],
      [
        "a removal in a here-string on a loop around bash",
        `while read l; do bash; done <<< '${D}'`,
      ],
      ["a removal in a heredoc on a brace group around bash", `{ bash; } <<'EOF'\n${D}\nEOF`],
      ["a removal piped into su behind pkexec", `echo '${D}' | pkexec su`],
      ["a removal piped into pkexec's own root shell", `echo '${D}' | pkexec`],
    ],
  },
  {
    folders: ["process data folder", "process home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a harmless here-string on a brace group around sudo's root shell",
        "{ sudo -s; } <<< 'ls -la'",
      ],
      ["a harmless here-string on descriptor 3 duplicated onto su's stdin", "su 3<<< 'ls' <&3"],
      [
        "a harmless echo's command substitution in a here-string to sudo's root shell",
        `sudo -s <<< "$(echo ls)"`,
      ],
      [
        "a harmless variable the line sets, in a here-string to sudo's root shell",
        `S=ls; sudo -s <<< "$S"`,
      ],
    ],
  },
]
