import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-unslotted-run"],
    rows: () => [
      [
        "an install after a run-slot call whose words cd away",
        "~/.playground/ops/run-slot.sh me -- cd /tmp; bun install",
      ],
      [
        "a build after a run-slot call whose words cd away",
        "~/.playground/ops/run-slot.sh me -- cd /tmp && bun run build",
      ],
      [
        "an install after a run-slot call whose words pushd away",
        "~/.playground/ops/run-slot.sh me -- pushd /tmp; bun install",
      ],
    ],
  },
]
