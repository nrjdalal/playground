import type { Group } from "./_shared"

// #1215: a writing redirect's target is judged as a writer's target is, so a variable the line sets to the root names the root, and one the hook cannot read is refused as tee to it is; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a redirect through a variable the line sets to the root",
        "D=~/.playground/extensions; echo x > $D/x",
      ],
      [
        "an append through a variable the line sets to the root",
        "D=~/.playground/extensions; echo x >> $D/x",
      ],
      [
        "a quoted redirect through a variable the line sets to the root",
        'D=~/.playground/extensions; echo x > "$D/x"',
      ],
      [
        "a redirect through a variable the line exports to the root",
        "export D=~/.playground/extensions; echo x > $D/x",
      ],
      [
        "a quoted append through a variable the line exports to the root",
        'export D=~/.playground/extensions; echo x >> "$D"/x',
      ],
      ["a redirect through a variable the hook cannot read", "echo x > $D/x"],
      ["a quoted append through a variable the hook cannot read", 'echo x >> "$D/x"'],
    ],
  },
]
