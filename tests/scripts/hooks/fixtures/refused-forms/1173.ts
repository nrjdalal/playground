import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "GNU mv to the shell's folder attached to its short target option after a cd to a variable",
        `cd "$D"; gmv -t. /tmp/f`,
      ],
      [
        "GNU mv to the shell's folder attached to its target option in a cluster after a cd to a variable",
        `cd "$D"; gmv -ft. /tmp/f`,
      ],
      [
        "GNU mv to the shell's folder by its long target option after a cd to a variable",
        `cd "$D"; gmv --target-directory=. /tmp/f`,
      ],
      [
        "GNU mv to the shell's folder by its shortened long target option after a cd to a variable",
        `cd "$D"; gmv --target=. /tmp/f`,
      ],
      [
        "rsync with a relative log file attached after a cd to a variable",
        `cd "$D"; rsync -a --log-file=x /tmp/a /tmp/b`,
      ],
      [
        "rsync with a relative temp folder attached after a cd to a variable",
        `cd "$D"; rsync -a --temp-dir=x /tmp/a /tmp/b`,
      ],
      [
        "rsync with a relative temp folder attached to its short option after a cd to a variable",
        `cd "$D"; rsync -a -Tx /tmp/a /tmp/b`,
      ],
      [
        "rsync with a relative temp folder attached in a cluster after a cd to a variable",
        `cd "$D"; rsync -aTx /tmp/a /tmp/b`,
      ],
      [
        "rsync with a relative partial folder attached after a cd to a variable",
        `cd "$D"; rsync -a --partial-dir=x /tmp/a /tmp/b`,
      ],
      [
        "rsync with a relative backup folder attached after a cd to a variable",
        `cd "$D"; rsync -a --backup-dir=x /tmp/a /tmp/b`,
      ],
      [
        "rsync with a relative batch file attached after a cd to a variable",
        `cd "$D"; rsync -a --write-batch=x /tmp/a /tmp/b`,
      ],
      [
        "rsync with a relative batch-only file attached after a cd to a variable",
        `cd "$D"; rsync -a --only-write-batch=x /tmp/a /tmp/b`,
      ],
    ],
  },
]
