import type { Group } from "./_shared"

// #2182: an in-place sed or perl edit whose file comes from a value the hook does not hold, a substitution or a variable it never saw set, could edit a file in the root, while cp and tee given the same value were refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home", "data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => [
      [
        "an in-place sed on a file from a substitution",
        `sed -i '' 's/a/b/' $(echo ${ROOT}/policy.json)`,
      ],
      [
        "an in-place sed on a file from a quoted substitution",
        `sed -i '' 's/a/b/' "$(echo ${ROOT}/policy.json)"`,
      ],
      [
        "an in-place sed on a file from a backtick substitution",
        `sed -i '' 's/a/b/' \`echo ${ROOT}/policy.json\``,
      ],
      ["an in-place sed on a quoted variable the hook does not hold", `sed -i '' 's/a/b/' "$X"`],
      ["an in-place sed on a variable the hook does not hold", `sed -i '' 's/a/b/' $X`],
      [
        "an in-place perl edit on a file from a substitution",
        `perl -pi -e 's/a/b/' $(echo ${ROOT}/policy.json)`,
      ],
      ["an in-place perl edit on a variable the hook does not hold", `perl -pi -e 's/a/b/' "$X"`],
      [
        "an in-place sed on a file from a substitution, on a line read whole",
        `sleep 1; sed -i '' 's/a/b/' $(echo ${ROOT}/policy.json)`,
      ],
      [
        "an in-place sed on a variable the hook does not hold, on a line read whole",
        `sleep 1; sed -i '' 's/a/b/' "$X"`,
      ],
      [
        "an in-place sed on files from a substitution reading a list, on a line read whole",
        `sleep 1; sed -i '' 's/a/b/' $(cat list)`,
      ],
      ["an in-place sed on a variable the call holds", `X=notes.md; sed -i '' 's/a/b/' "$X"`],
      ["a sed that prints a file from a substitution", `sed -n 's/a/b/p' $(echo notes.md)`],
    ],
  },
]

export const allowed: string[] = [
  "an in-place sed on a variable the call holds",
  "a sed that prints a file from a substitution",
]
