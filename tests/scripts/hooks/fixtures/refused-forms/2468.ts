import { type Group } from "./_shared"

// A reviewer in read mode running code-review-loop's merge check, which runs the outside PR's tests in its clone, rather than its --conflict-only form; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["main checkout"],
    guards: ["no-outside-pr-code"],
    rows: ({ MAIN }) => {
      const state = `${MAIN}/extensions/core/skills/code-review-loop/scripts/state.ts`
      return [
        [
          "state.ts merge by its path, which runs the PR's tests",
          `${state} merge /s/review-501 abc1234 origin/canary r-reviewer`,
        ],
        [
          "state.ts merge with --conflict-only only as the clone's name",
          `${state} merge /s/--conflict-only abc1234 origin/canary r-reviewer`,
        ],
      ]
    },
  },
]
