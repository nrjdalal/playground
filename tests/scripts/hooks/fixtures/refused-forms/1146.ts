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
    ],
  },
]
