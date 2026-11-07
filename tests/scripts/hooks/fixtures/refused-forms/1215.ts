import type { Group } from "./_shared"

// #1215: a writing redirect's target through a variable is judged by what the value the hook holds for it names, an assignment's, a bare export's and a for loop's literal words inside its body each in turn, so a variable the line sets to the root names the root; rows are data, as refused-forms.ts says.
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
      [
        "a redirect through a loop variable after its loop has ended",
        "for d in x; do :; done; echo y > $d/y",
      ],
      ["a redirect on a loop's done through its variable", "for id in 1 2; do :; done > $id.log"],
      [
        "a redirect through a loop variable its body sets again",
        "for id in 1 2; do echo x > $id.log; id=y; done",
      ],
      [
        "a redirect through a loop variable whose list expands",
        "for id in 1 $X; do echo x > $id.log; done",
      ],
    ],
  },
  {
    folders: ["process data folder"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a redirect through a for loop's word that spells the root",
        "for id in ext a; do echo x > ${id}ensions/x; done",
      ],
      [
        "a redirect through a for loop's word that climbs into the root",
        "for id in x; do echo x > $id/../extensions/y; done",
      ],
      [
        "a redirect after an echo whose words read as a for loop",
        "echo for d in extensions; echo x > $d/y",
      ],
    ],
  },
]

// A target whose value the hook does not hold runs, as it did before #1215; #1237 refuses each as tee to it is
export const allowed = [
  "a redirect through a variable the hook cannot read",
  "a quoted append through a variable the hook cannot read",
  "a redirect through a loop variable after its loop has ended",
  "a redirect on a loop's done through its variable",
  "a redirect through a loop variable its body sets again",
  "a redirect through a loop variable whose list expands",
  "a redirect after an echo whose words read as a for loop",
]
