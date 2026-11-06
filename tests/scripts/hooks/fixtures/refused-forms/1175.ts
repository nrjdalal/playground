import { type Group, NEVER_MADE } from "./_shared"

const D = `rm -rf ${NEVER_MADE}`
const SHELLS = ["bash", "sudo -s", "su"]
const R = "gh pr comment 12 -R qmarsh/demo --body-file -"
const L = "gh issue comment 3 -R acme-blue/app --body-file -"
const Q = "curl -s https://api.linear.app/graphql -d @-"

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
  // The round-1 review's probe: stdin a guard reads as data keeps canary's reading, so each of these stays refused
  {
    folders: ["checkout"],
    guards: ["no-release-comment"],
    rows: () => [
      ["a harmless body on a brace group", `{ ${R}; } <<< 'Ready to ship'`],
      ["a harmless body on descriptor 3 duplicated", `${R} 3<<< 'Ready to ship' <&3`],
      ["a harmless body by an echo substitution", `${R} <<< "$(echo Ready to ship)"`],
      ["a harmless body by a line variable", `S='Ready to ship'; ${R} <<< "$S"`],
      [
        "a body by a variable reset only under ||",
        `S='Released in v2'; true || S=fine; ${R} <<< "$S"`,
      ],
      [
        "a body by a variable read changes",
        `S=fine; read -r S <<< 'Released in v2'; ${R} <<< "$S"`,
      ],
      [
        "a body an exec inside the group swaps onto stdin",
        `{ exec 0<&3; ${R}; } 3<<< 'Released in v2' <<< 'fine'`,
      ],
      [
        "a body by a for loop's variable",
        `S=fine; for S in 'Released in v2'; do ${R} <<< "$S"; done`,
      ],
    ],
  },
  {
    folders: ["home"],
    guards: ["no-playground-leak"],
    rows: () => [
      ["a harmless body on a brace group", `{ ${L}; } <<< 'Looks good'`],
      ["a harmless body by a line variable", `S='Looks good'; ${L} <<< "$S"`],
      [
        "a body by a variable reset only under ||",
        `S='see roster.json'; true || S=fine; ${L} <<< "$S"`,
      ],
      [
        "a body an exec inside the group swaps onto stdin",
        `{ exec 0<&3; ${L}; } 3<<< 'see roster.json' <<< 'fine'`,
      ],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-linear-ticket"],
    rows: () => [
      ["a harmless query on a brace group", `{ ${Q}; } <<< '{"query":"{ viewer { id } }"}'`],
      ["a harmless query by a line variable", `V='{"query":"{ viewer { id } }"}'; ${Q} <<< "$V"`],
    ],
  },
  {
    folders: ["checkout", "process data folder", "process home", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      ["a recursive delete in a here-string, stdin then closed, to bash", `bash <<< '${D}' <&-`],
      [
        "a recursive delete in a here-string, then a duplicate from an unfed descriptor, to bash",
        `bash <<< '${D}' 0<&3`,
      ],
      [
        "a recursive delete in a here-string, stdin then closed, to sudo's root shell",
        `sudo -s <<< '${D}' <&-`,
      ],
      [
        "a recursive delete on descriptor 3 duplicated onto descriptor 0 by >&, to bash",
        `bash 3<<< '${D}' 0>&3`,
      ],
      [
        "a recursive delete on descriptor 3 duplicated onto descriptor 0 by >&, to sudo's root shell",
        `sudo -s 3<<< '${D}' 0>&3`,
      ],
      ["a recursive delete on descriptor 3 moved onto stdin, to bash", `bash 3<<< '${D}' <&3-`],
      [
        "a recursive delete on descriptor 3 an outer group feeds, to bash",
        `{ bash 0<&3; } 3<<< '${D}'`,
      ],
      [
        "a recursive delete after an escaped line break in an echo's substitution, to bash",
        `bash <<< "$(echo 'ls\\n${D}')"`,
      ],
      [
        "a recursive delete echoed after a nested here-string's substitution, to bash",
        `bash <<< "$(cat <<< ls); $(echo ${D})"`,
      ],
      ["a harmless job for at on descriptor 3 duplicated", "at now 3<<< 'ls' <&3"],
      [
        "a recursive delete for at by a variable reset only under ||",
        `S='${D}'; true || S=ls; at now <<< "$S"`,
      ],
    ],
  },
  {
    folders: ["process home"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["xargs fed a harmless path on a brace group", "{ xargs rm -rf; } <<< /tmp/.no-such-1192"],
      [
        "xargs fed the root's path by a variable reset only under ||",
        `S=${NEVER_MADE}; true || S=/tmp/.no-such-1192; xargs rm -rf <<< "$S"`,
      ],
      [
        "xargs fed the root's path an exec inside the group swaps onto stdin",
        `{ exec 0<&3; xargs rm -rf; } 3<<< ${NEVER_MADE} <<< /tmp/.no-such-1192`,
      ],
      [
        "a removal on descriptor 3 duplicated onto descriptor 0 by >&, to bash",
        `bash 3<<< '${D}' 0>&3`,
      ],
      ["a removal on descriptor 3 moved onto stdin, to bash", `bash 3<<< '${D}' <&3-`],
      ["a removal on descriptor 3 an outer group feeds, to bash", `{ bash 0<&3; } 3<<< '${D}'`],
      [
        "a removal after an escaped line break in an echo's substitution, to bash",
        `bash <<< "$(echo 'ls\\n${D}')"`,
      ],
    ],
  },
  // The round-2 review's probe: a here-string holding an echo substitution keeps the rest of its text readable, as on canary
  {
    folders: ["checkout", "process data folder", "process home", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      [
        "a recursive delete beside an echo substitution in a here-string cat feeds to bash",
        `cat <<< "${D} $(echo x)" | bash`,
      ],
      [
        "a recursive delete beside an echo substitution in a here-string cat feeds to sudo's root shell",
        `cat <<< "${D} $(echo x)" | sudo -s`,
      ],
      [
        "a recursive delete beside an echo substitution in a here-string tee feeds to bash",
        `tee <<< "${D} $(echo x)" | bash`,
      ],
    ],
  },
  {
    folders: ["process home"],
    guards: ["no-raw-delete"],
    rows: () => [
      [
        "a relative recursive delete on descriptor 3 duplicated to bash, its own here-string a cd away",
        "bash <<< 'cd /tmp' 3<<< 'rm -rf .playground/extensions/.no-such-folder' <&3",
      ],
    ],
  },
  {
    folders: ["process home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal beside an echo substitution in a here-string cat feeds to bash",
        `cat <<< "${D} $(echo x)" | bash`,
      ],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-linear-ticket"],
    rows: () => [
      [
        "python fed a here-string naming issueCreate beside an echo substitution",
        `python3 <<< "issueCreate $(echo x)"`,
      ],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      [
        "a commit beside an echo substitution in a here-string cat feeds to bash",
        `cat <<< "git commit -m x $(echo y)" | bash`,
      ],
      [
        "a harmless script on descriptor 3 duplicated to a root shell",
        "sudo -s 3<<< 'git status' <&3",
      ],
      ["a commit on descriptor 3 duplicated to a root shell", "sudo -s 3<<< 'git commit -m x' <&3"],
      ["a harmless script on a group around a root shell", "{ sudo -s; } <<< 'git status'"],
      [
        "a commit on descriptor 3 duplicated to a root shell by >&",
        "sudo -s 3<<< 'git commit -m x' 0>&3",
      ],
    ],
  },
]
