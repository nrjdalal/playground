import { type Group, NEVER_MADE } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      [
        "an eval through a function the call names agent-browser",
        `agent-browser() { sh -c "$2"; }; agent-browser eval 'rm -rf ${NEVER_MADE}'`,
      ],
      [
        "an eval through a function keyword the call names agent-browser",
        `function agent-browser { sh -c "$2"; }; agent-browser eval 'rm -rf ${NEVER_MADE}'`,
      ],
      [
        "an eval through an alias the call names agent-browser",
        `alias agent-browser='sh -c'; agent-browser eval 'rm -rf ${NEVER_MADE}'`,
      ],
      [
        "an eval through a name the call hashes as agent-browser",
        `hash -p /bin/sh agent-browser; agent-browser eval 'rm -rf ${NEVER_MADE}'`,
      ],
      [
        "an eval through a PATH the command sets",
        `PATH=/tmp/no-such-dir:$PATH agent-browser eval 'rm -rf ${NEVER_MADE}'`,
      ],
      [
        "an eval through a PATH the call exports",
        `export PATH=/tmp/no-such-dir:$PATH; agent-browser eval 'rm -rf ${NEVER_MADE}'`,
      ],
      [
        "an eval through an agent-browser in the folder",
        `./agent-browser eval 'rm -rf ${NEVER_MADE}'`,
      ],
      [
        "an eval through an agent-browser by its path",
        `/tmp/no-such-dir/agent-browser eval 'rm -rf ${NEVER_MADE}'`,
      ],
      ["an option's value spelled eval", `agent-browser --session eval 'rm -rf ${NEVER_MADE}'`],
      [
        "an option's value spelled eval before a shell",
        `agent-browser --session eval sh -c 'rm -rf ${NEVER_MADE}'`,
      ],
      ["a short option's value spelled eval", `agent-browser -p eval 'rm -rf ${NEVER_MADE}'`],
      [
        "an eval line read out of another agent-browser command's word",
        `agent-browser open 'agent-browser eval "rm -rf ${NEVER_MADE}"'`,
      ],
      [
        "an eval line through a function read out of another agent-browser command's word",
        `agent-browser open 'agent-browser() { sh -c "$2"; }; agent-browser eval "rm -rf ${NEVER_MADE}"'`,
      ],
      [
        "an eval line read out of agent-browser batch's word",
        `agent-browser batch 'agent-browser eval "rm -rf ${NEVER_MADE}"'`,
      ],
    ],
  },
]
