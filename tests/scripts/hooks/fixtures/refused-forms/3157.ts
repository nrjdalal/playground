import { type Group } from "./_shared"

// #3157: a shell append of a well-formed approval line to the unused-space approvals log, whose one writer is playground rm --approve; rows are data, as refused-forms.ts says.
const LINE = `{"at":"2026-11-27T00:00:00.000Z","by":"ops","bytes":1,"choice":"remove","list":"x","machine":"m","path":"/x"}`

export const groups: Group[] = [
  {
    folders: ["process tmp"],
    guards: ["no-roster-write"],
    rows: () => [
      [
        "an echo of a well-formed approval line appended to the approvals log",
        `echo '${LINE}' >> ~/.playground/ops/tick/unused-approvals.jsonl`,
      ],
      [
        "a tee -a of a well-formed approval line onto the approvals log",
        `echo '${LINE}' | tee -a ~/.playground/ops/tick/unused-approvals.jsonl`,
      ],
    ],
  },
]
