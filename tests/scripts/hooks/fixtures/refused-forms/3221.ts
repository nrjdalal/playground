import { type Group, NEVER_MADE } from "./_shared"

// #3221: an --args or --session option after a browser command the hook keeps as text still carries a value of its own, and one holding a blank is a command line; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "process home"],
    guards: ["no-raw-delete"],
    rows: () => [
      [
        "a selector click with two bracketed parts and a launch arg that runs a remover",
        `agent-browser click '[a] [b]' --args "--renderer-cmd-prefix=rm -rf ${NEVER_MADE}"`,
      ],
      [
        "a selector click with one bracketed part and a launch arg that runs a remover",
        `agent-browser click '[a]' --args "--renderer-cmd-prefix=rm -rf ${NEVER_MADE}"`,
      ],
      [
        "a browser eval and a launch arg that runs a remover",
        `agent-browser eval 'x' --args "--renderer-cmd-prefix=rm -rf ${NEVER_MADE}"`,
      ],
    ],
  },
]
