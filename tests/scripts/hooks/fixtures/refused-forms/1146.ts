import { type Group, NEVER_MADE } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "process data folder", "process home", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      [
        "a recursive delete in a here-string to sudo's root shell",
        `sudo -s <<< 'rm -rf ${NEVER_MADE}'`,
      ],
      [
        "a recursive delete in a here-string to su behind sudo",
        `sudo su <<< 'rm -rf ${NEVER_MADE}'`,
      ],
      ["a recursive delete in a here-string to su's root shell", `su <<< 'rm -rf ${NEVER_MADE}'`],
      [
        "a recursive delete in a heredoc to sudo's root shell",
        `sudo -s <<'EOF'\nrm -rf ${NEVER_MADE}\nEOF`,
      ],
      [
        "a recursive delete in a heredoc to su behind sudo",
        `sudo su <<'EOF'\nrm -rf ${NEVER_MADE}\nEOF`,
      ],
      [
        "a recursive delete in a heredoc to su's root shell",
        `su <<'EOF'\nrm -rf ${NEVER_MADE}\nEOF`,
      ],
      [
        "a recursive delete before an unset variable in a here-string to sudo's root shell",
        `sudo -s <<< "rm -rf ${NEVER_MADE}; echo $NO_SUCH_VAR_1146"`,
      ],
      [
        "a recursive delete after an unset variable in a here-string to sudo's root shell",
        `sudo -s <<< "echo $NO_SUCH_VAR_1146; rm -rf ${NEVER_MADE}"`,
      ],
      [
        "a recursive delete before a download's output in a here-string to su's root shell",
        `su <<< "rm -rf ${NEVER_MADE}; echo $(curl -s example.com)"`,
      ],
      [
        "a recursive delete before an unset variable in an unquoted heredoc to sudo's root shell",
        `sudo -s <<EOF\nrm -rf ${NEVER_MADE}\necho $NO_SUCH_VAR_1146\nEOF`,
      ],
      [
        "a recursive delete in a file the line writes beside a download, fed to su behind sudo",
        `{ echo 'rm -rf ${NEVER_MADE}'; curl -s example.com; } > /tmp/.no-such-script-1146; sudo su < /tmp/.no-such-script-1146`,
      ],
    ],
  },
]
