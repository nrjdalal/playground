import type { Group } from "./_shared"

// #2176: an in-place sed whose script spells the root other than literally, by a glob or behind sed's escaped slashes, writes that path into a file a shell may run later, a git hook included, which holds() let pass since it read only the literal spelling; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: ({ DATA }) => [
      [
        "an in-place sed whose s/// writes a * glob of the root under ~ into a file",
        String.raw`sed -i '' 's/a/touch ~\/.play*\/extensions\/x/' run.sh`,
      ],
      [
        "an in-place sed whose s/// writes a * glob of the root under ~ into a git hook",
        String.raw`sed -i '' 's/a/touch ~\/.play*\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose -e s/// writes a * glob of the root into a git hook",
        String.raw`sed -i '' -e 's/a/touch ~\/.play*\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose s/// writes a ? glob of the root into a git hook",
        String.raw`sed -i '' 's/a/touch ~\/.p?ayground\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose s/// writes a [ glob of the root into a git hook",
        String.raw`sed -i '' 's/a/touch ~\/.[p]layground\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose s/// writes a { glob of the root into a git hook",
        String.raw`sed -i '' 's/a/touch ~\/.{playground,x}\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose s/// writes a glob of a folder above the root into a git hook",
        String.raw`sed -i '' 's/a/touch ~\/*\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose s/// writes a glob of the root under $HOME into a git hook",
        String.raw`sed -i '' 's/a/touch $HOME\/.play*\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose s/// writes the root behind escaped slashes into a git hook",
        String.raw`sed -i '' 's/a/touch ~\/.playground\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose s/// writes a glob of the root, on a line read whole for its redirect into a git hook",
        String.raw`sed -i '' 's/a/touch ~\/.play*\/extensions\/x/' run.sh; echo x >> .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose s/// spells the root by the text its & matched",
        String.raw`sed -i '' 's/layground/~\/.p&\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose s/// spells the root by a group it matched",
        String.raw`sed -i '' 's/\(layground\)/~\/.p\1\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose second s/// writes a glob of the root, after an address naming s/",
        String.raw`sed -i '' '/as/d;s/a/touch ~\/.play*\/extensions\/x/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed of an ordinary regex on a file in the session's scratch",
        `sed -i '' 's/a*b/c/' ${DATA}/scratch/w/a.txt`,
      ],
      [
        "an in-place sed whose s/// writes a glob outside the root into a git hook",
        String.raw`sed -i '' 's/a/ls ~\/work\/*.ts/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose s/// writes a path in the scratch into a git hook",
        String.raw`sed -i '' 's/a/ls ~\/.playground\/scratch\/w/' .git/hooks/pre-commit`,
      ],
      [
        "an in-place sed whose /regex/d holds an absolute path and a glob",
        String.raw`sed -i '' '/\/tmp\/.*\.log/d' run.sh`,
      ],
      [
        "an in-place sed whose s/// pattern names the root and writes a plain word",
        String.raw`sed -i '' 's/~\/.play*\/extensions/x/' run.sh`,
      ],
      ["an in-place sed whose s/// writes the text its & matched", `sed -i '' 's/a.*/[&]/' run.sh`],
    ],
  },
]

export const allowed: string[] = [
  "an in-place sed of an ordinary regex on a file in the session's scratch",
  "an in-place sed whose s/// writes a glob outside the root into a git hook",
  "an in-place sed whose s/// writes a path in the scratch into a git hook",
  "an in-place sed whose /regex/d holds an absolute path and a glob",
  "an in-place sed whose s/// pattern names the root and writes a plain word",
  "an in-place sed whose s/// writes the text its & matched",
]
