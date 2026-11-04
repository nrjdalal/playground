import { homedir } from "node:os"

import { type Group, NEVER_MADE } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => {
      const W = `${MAIN}/.claude/worktrees/a`
      return [
        ["a commit after a cd behind ||", `true || cd ${W}; git commit -m x`],
        [
          "a commit after a cd behind && whose left side may fail",
          `false && cd ${W}; git commit -m x`,
        ],
        [
          "a commit the ; frees from the && that made the cd before it sure",
          `true && cd ${W}; git commit -m x`,
        ],
        [
          "a commit the ; frees from a chained cd into the folder the line makes",
          `mkdir -p ${W}/sub && cd ${W}/sub; git commit -m x`,
        ],
        [
          "a commit after a chained cd and one it cannot read",
          `true && cd ${W} && cd "$D" && git commit -m x`,
        ],
        [
          "a commit after a negated cd, which runs only because that cd failed",
          `git status && ! cd ${W}/nope && git commit -m x`,
        ],
        [
          "a commit after a negated cd through builtin",
          `true && ! builtin cd ${W}/nope && git commit -m x`,
        ],
        [
          "a commit a newline frees from the chained cd before it",
          `true && cd ${W}\ngit commit -m x`,
        ],
        ["a commit on an || after a chained cd", `true && cd ${W} || git commit -m x`],
        [
          "a commit after an eval whose own chained cd may not have run",
          `eval 'true && cd ${W}/nope'; git commit -m x`,
        ],
        [
          "a commit in a subshell the chained cd's own run does not reach",
          `true && cd ${W}/nope; (git commit -m x)`,
        ],
        [
          "a commit in a subshell on the || of a chained cd",
          `true && cd ${W}/nope || (git commit -m x)`,
        ],
        [
          "a commit in a substitution the chained cd's own run does not reach",
          `true && cd ${W}/nope; echo $(git commit -m x)`,
        ],
        [
          "a commit in a process substitution after a chained cd",
          `true && cd ${W}/nope; cat <(git commit -m x)`,
        ],
        [
          "a commit in backticks after a chained cd",
          `true && cd ${W}/nope; echo \`git commit -m x\``,
        ],
        [
          "a commit in a substitution an assignment reads after a chained cd",
          `true && cd ${W}/nope; x=$(git commit -m x)`,
        ],
        ["a commit after a backgrounded chained cd", `true && cd ${W} & git commit -m x`],
        ["a commit after a cd to a missing folder", `cd ${MAIN}/.no-such-folder; git commit -m x`],
        ["a commit after a cd to a folder in a variable", `cd "$X"; git commit -m x`],
        ["a commit after a cd in an if branch", `if false; then cd ${W}; fi; git commit -m x`],
        [
          "a commit after a cd in a loop that runs no time",
          `while false; do cd ${W}; done; git commit -m x`,
        ],
        ["a commit after a cd in a case branch", `case x in y) cd ${W};; esac; git commit -m x`],
        [
          "a commit after a function that holds a cd and is never called",
          `f() { cd ${W}; }; git commit -m x`,
        ],
        ["a commit after a cd behind env", `env cd ${W}; git commit -m x`],
        ["a commit after a cd xargs runs", `echo ${W} | xargs cd; git commit -m x`],
        ["a commit after a cd in a coprocess", `coproc cd ${W}; git commit -m x`],
        ["a commit after a backgrounded cd", `cd ${W} & git commit -m x`],
        ["a commit after a cd piped into cat", `cd ${W} | cat; git commit -m x`],
        ["a commit after a backgrounded brace group's cd", `{ cd ${W}; } & git commit -m x`],
        ["a commit after pushd and popd", `pushd ${W}; popd; git commit -m x`],
        ["a commit after a cd back with cd -", `cd ${W}; cd -; git commit -m x`],
        ["a write after a cd behind ||", `true || cd ${W}; echo x > f`],
      ]
    },
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      [
        "a commit after a cd a loop's body holds",
        "for i in 1 2 3; do cd /tmp; done; git commit -m x",
      ],
      ["a commit after a cd repeat runs three times", "repeat 3 cd /tmp; git commit -m x"],
      [
        "a commit after zsh's two-operand cd",
        `cd ${MAIN}/.claude/worktrees/a ${MAIN}; git commit -m x`,
      ],
      [
        "a commit after a deeper directory stack's pushd and popd",
        `pushd ${MAIN}/.claude/worktrees/a; pushd ${homedir()}; popd; popd; git commit -m x`,
      ],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [["a script's output piped into a shell", "bun run ask list | sh"]],
  },
  // each form reaches the main checkout from a worktree, where the folder the line started in is not the guarded one
  {
    folders: ["checkout"],
    guards: ["no-main-checkout"],
    rows: ({ DATA, MAIN }) => [
      [
        "a commit after a relative cd with the folder already unnamed",
        `true || cd ${DATA}; cd ../../..; git commit -m x`,
      ],
      ["a commit after a relative cd repeat runs three times", "repeat 3 cd ..; git commit -m x"],
      [
        "a commit after a relative cd a loop's body holds",
        "for i in 1 2 3; do cd ..; done; git commit -m x",
      ],
      [
        "a commit after a function body's cd the next cd does not undo",
        `f() { cd ${MAIN}; }; cd ${DATA}; f; git commit -m x`,
      ],
      [
        "a commit after the cd a pipeline's last element runs",
        `echo | cd ${MAIN}; git commit -m x`,
      ],
      ["a commit after builtin cd", `builtin cd ${MAIN}; git commit -m x`],
      [
        "a commit after zsh's two-operand cd naming the main checkout",
        `cd ${MAIN} ${MAIN}; git commit -m x`,
      ],
      ["a commit after a two-operand cd of relative words", "cd ../.. ../..; git commit -m x"],
      ["a commit after command cd", `command cd ${MAIN}; git commit -m x`],
      ["a build after a cd behind || into the main checkout", `true || cd ${MAIN}; bun run build`],
      [
        "a write by a relative path after a cd behind || into the main checkout",
        `true || cd ${MAIN}; echo x > f`,
      ],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => {
      const W = `${MAIN}/.claude/worktrees/a`
      return [
        [
          "a commit after a cd in a branch whose own argument spells a closer",
          `if false; then echo done; cd ${W}; fi; git commit -m x`,
        ],
        [
          "a commit after a cd in a loop body whose own argument spells a closer",
          `while false; do grep -q done f; cd ${W}; done; git commit -m x`,
        ],
      ]
    },
  },
  // a line that names more folders than the reader carries, the guarded one past its cap of 32, so the shell reads as able to be in any folder
  {
    folders: ["checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      [
        "a commit after more cd steps than the reader carries, one into the main checkout",
        `${Array.from({ length: 32 }, (_, k) => `true || cd /tmp/d${k}`).join("; ")}; true || cd ${MAIN}; git commit -m x`,
      ],
    ],
  },
  // a body's cd runs at once, so a relative cd after it starts from the folder the body reached
  {
    folders: ["checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      ["a build after two relative cds in a brace group", "{ cd ..; cd ..; bun run build; }"],
      [
        "a build after two relative cds in a function body",
        "f() { cd ..; cd ..; bun run build; }; f",
      ],
      [
        "a build after a relative cd that follows a brace group's",
        "{ cd ..; }; cd ..; bun run build",
      ],
      [
        "a build after a relative pushd that follows a brace group's cd",
        "{ cd ..; }; pushd .. >/dev/null; bun run build",
      ],
      [
        "a build in a subshell whose relative cd follows a brace group's",
        "{ cd ..; }; (cd ..; bun run build)",
      ],
      [
        "a build after a relative cd that follows a coprocess's",
        "coproc cd ..; cd ..; bun run build",
      ],
      [
        "a commit after a relative cd that follows a brace group's",
        "{ cd ..; }; cd ..; git commit -m x",
      ],
      [
        "a write after a relative cd that follows a brace group's",
        "{ cd ..; }; cd ..; touch made-up-file",
      ],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      [
        "a build after a relative cd back from the worktree a brace group's cd reached",
        `{ cd ${MAIN}/.claude/worktrees/a; }; cd ../.. && bun run build`,
      ],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-unslotted-run"],
    rows: ({ MAIN }) => [
      [
        "a type check after a cd behind || into a worktree",
        `true || cd ${MAIN}/.claude/worktrees/a; bun run check-types`,
      ],
      [
        "a build after a relative cd into a worktree that follows a brace group's cd",
        `{ cd ${MAIN}/.claude; }; cd worktrees/a && bun run build`,
      ],
      [
        "a build after a brace group's relative cd into a worktree",
        `{ cd ${MAIN}/.claude; cd worktrees/a; bun run build; }`,
      ],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => [
      [
        "a write after a relative cd into the root that follows a brace group's cd",
        `{ cd ${ROOT}/..; }; cd extensions; touch x`,
      ],
      [
        "a write after a function body's relative cd into the root",
        `f() { cd ${ROOT}/..; cd extensions; touch x; }; f`,
      ],
      [
        "a redirect after a relative cd into the root that follows a brace group's cd",
        `{ cd ${ROOT}/..; }; cd extensions; echo x > policy.json`,
      ],
    ],
  },
  // past the cap of 32 the extensions root may be the folder the reader dropped, so a writing redirect by a relative path is refused before a reader or an echo lets it through
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => {
      const many = (joiner: string) =>
        Array.from({ length: 33 }, (_, k) => `cd /tmp/cap-${k}`).join(` ${joiner} `)
      return [
        [
          "an echo redirect after more cd steps than the reader carries, one into the root",
          `${many("||")} || cd ${ROOT}; echo x > policy.json`,
        ],
        [
          "a reader's redirect after more cd steps than the reader carries, one into the root",
          `${many("&&")} || cd ${ROOT}; cat f > policy.json`,
        ],
        [
          "a bare redirect after more cd steps than the reader carries, one into the root",
          `${many(";")} || cd ${ROOT}; > policy.json`,
        ],
      ]
    },
  },
  {
    folders: ["data folder"],
    guards: ["no-extensions-write"],
    rows: ({ WORK }) => [
      [
        "a write by a relative path after a cd behind || out of the data folder",
        `true || cd ${WORK}; echo x > extensions/policy.json`,
      ],
    ],
  },
  {
    folders: ["tmp"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT, SCOPE }) => [
      ["a program run after a cd behind || into the extensions root", `true || cd ${SCOPE}; true`],
      ["a program run after a two-operand cd into the extensions root", `cd ${ROOT} ${ROOT}; true`],
    ],
  },
  // a bare pushd, which zsh sends home on a one-folder stack, so a relative path after one may be in the root; the home is the one ~ expands to, so these rows sit in the process's own worktree folder
  {
    folders: ["process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a relative rm after a bare pushd",
        `pushd >/dev/null; rm -rf ${NEVER_MADE.replace("~/", "")}`,
      ],
      ["a relative write after a bare pushd", `pushd; echo x > ${NEVER_MADE.replace("~/", "")}/f`],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-linear-ticket"],
    rows: ({ DATA }) => [
      [
        "a write to the approvals folder after a brace group's cd into the data folder",
        `{ cd ${DATA}; }; echo x > ticket-approvals/foo`,
      ],
      ["the same write inside that brace group", `{ cd ${DATA}; echo x > ticket-approvals/foo; }`],
      [
        "a write to the approvals folder after a function body's cd the line calls",
        `f() { cd ${DATA}; }; f; touch ticket-approvals/foo`,
      ],
      [
        "a write to the approvals folder after a cd on an ||'s right side",
        `false || cd ${DATA}; touch ticket-approvals/foo`,
      ],
      [
        "a write to the approvals folder a ; frees from the && that made the cd before it sure",
        `true && cd ${DATA}; touch ticket-approvals/foo`,
      ],
      [
        "a write to the approvals folder after a cd an if branch holds",
        `if true; then cd ${DATA}; fi; touch ticket-approvals/foo`,
      ],
    ],
  },
  {
    folders: ["data folder"],
    guards: ["no-playground-leak"],
    rows: () => [
      [
        "a pull request naming no repository after a brace group's cd the hook cannot read",
        `{ cd ${NEVER_MADE}; }; gh pr create --title t --body b`,
      ],
      [
        "the same after a function body's cd the line calls",
        `f() { cd ${NEVER_MADE}; }; f; gh pr create --title t --body b`,
      ],
    ],
  },
  {
    folders: ["process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      ["a delete after a brace group's cd out of the worktree", "{ cd /tmp; }; rm foo"],
      ["the same with the group joined to it by an &&", "{ cd /tmp; } && rm foo"],
      ["the same with a chain inside the group", "{ cd /tmp && true; }; rm foo"],
      ["the same with the group's output redirected", "{ cd /tmp; } > /dev/null; rm foo"],
      ["the same with a newline for the ;", "{ cd /tmp; }\nrm foo"],
      ["the same with the group behind an &&", "true && { cd /tmp; }; rm foo"],
      ["a delete inside the group that holds the cd", "{ cd /tmp; rm foo; }"],
      ["a delete after a brace group's cd into the main checkout", "{ cd ~/playground; }; rm foo"],
      ["a delete after a brace group's cd to the home", "{ cd ~; }; rm foo"],
      ["a delete after a brace group's relative cd above the worktree", "{ cd ..; }; rm foo"],
      ["a delete after a brace group's cd on an ||'s left side", "{ cd /tmp; } || true; rm foo"],
      ["a delete after a negated brace group's cd", "! { cd /tmp; }; rm foo"],
      ["a delete after a cd two brace groups deep", "{ { cd /tmp; }; }; rm foo"],
      ["a delete by a relative path after a brace group's cd", "{ cd /tmp; }; rm ./foo"],
      ["a delete after a function body's cd the line calls", "f() { cd /tmp; }; f; rm foo"],
      [
        "the same with the function written with the function word",
        "function f { cd /tmp; }; f; rm foo",
      ],
      ["the same with the delete joined to the call by an &&", "f() { cd /tmp; }; f && rm foo"],
      ["a delete inside the function body that holds the cd", "f() { cd /tmp; rm foo; }; f"],
      ["the same with each command on its own line", "f() { cd /tmp; }\nf\nrm foo"],
    ],
  },
]
