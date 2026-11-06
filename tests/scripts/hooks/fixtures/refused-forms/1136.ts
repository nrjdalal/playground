import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "rm of a dashed relative file after its first operand after a cd to a variable",
        `cd "$D"; rm /tmp/x -f`,
      ],
      [
        "rmdir of a dashed relative folder after its first operand after a cd to a variable",
        `cd "$D"; rmdir /tmp/x -p`,
      ],
      [
        "mv to a dashed relative path after its first operand after a cd to a variable",
        `cd "$D"; mv /tmp/x -f`,
      ],
      [
        "unlink of a dashed relative file after its first operand after a cd to a variable",
        `cd "$D"; unlink /tmp/x -f`,
      ],
      [
        "GNU rm of a dashed relative file after its first operand under POSIXLY_CORRECT after a cd to a variable",
        `cd "$D"; POSIXLY_CORRECT=1 grm /tmp/x -f`,
      ],
    ],
  },
]
