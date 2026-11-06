import { type Group } from "./_shared"

// An eval of a word the hook cannot read, whose text the shell runs as code; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["an eval of a quoted variable", 'eval "$X"'],
      ["an eval of an unquoted variable", "eval $X"],
      ["an eval of a braced variable", "eval ${X}"],
      ["an eval of a variable with a default", 'eval "${X:-true}"'],
      ["an eval of arithmetic", "eval $((1))"],
      ["an eval of a quoted command substitution", 'eval "$(printf x)"'],
      ["an eval of an unquoted command substitution", "eval $(printf x)"],
      ["an eval of a backtick substitution", "eval `printf x`"],
      ["an eval of a variable after literal words", 'eval echo "$X"'],
      ["an eval of a variable set from a substitution", 'X=$(printf x); eval "$X"'],
      ["an eval of a variable through builtin", 'builtin eval "$X"'],
      ["an eval of a variable through command", 'command eval "$X"'],
      ["an eval of a variable in a function", 'f() { eval "$X"; }; f'],
      ["an eval of a variable in a loop", 'for i in 1; do eval "$X"; done'],
      ["an eval of a variable in zsh -c", `zsh -c 'eval "$X"'`],
      ["an eval of a variable in bash -c", `bash -c 'eval "$X"'`],
      ["an eval of a variable in sh -c", `sh -c 'eval "$X"'`],
    ],
  },
]
