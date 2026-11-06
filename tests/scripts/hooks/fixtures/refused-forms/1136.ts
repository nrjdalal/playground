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
      [
        "rm of a lone dash before its first operand after a cd to a variable",
        `cd "$D"; rm - /tmp/x`,
      ],
      ["GNU rm of a lone dash after a cd to a variable", `cd "$D"; grm /tmp/x -`],
      ["unlink of a lone dashed file after a cd to a variable", `cd "$D"; unlink -x`],
      [
        "GNU rm of a dashed relative file after its first operand under an exported POSIXLY_CORRECT after a cd to a variable",
        `export POSIXLY_CORRECT=1; cd "$D"; grm /tmp/x -f`,
      ],
      ["rm of a lone dash and a dashed relative file after a cd to a variable", `cd "$D"; rm - -f`],
      [
        "rm past an option of a lone dash and a dashed relative file after a cd to a variable",
        `cd "$D"; rm -f - -i`,
      ],
      [
        "rmdir of a lone dash and a dashed relative folder after a cd to a variable",
        `cd "$D"; rmdir - -p`,
      ],
      ["mv of a lone dash to a dashed relative path after a cd to a variable", `cd "$D"; mv - -f`],
      [
        "GNU rm of a lone dash and a dashed relative file under POSIXLY_CORRECT after a cd to a variable",
        `cd "$D"; POSIXLY_CORRECT=1 grm - -f`,
      ],
      ["rm of a lone dash alone after a cd to a variable", `cd "$D"; rm -`],
      ["unlink of a lone dash after a cd to a variable", `cd "$D"; unlink -`],
      [
        "rm of a dashed relative file after an end of options after its first operand after a cd to a variable",
        `cd "$D"; rm /tmp/x -- -f`,
      ],
    ],
  },
]
