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
      // a file's name is the eval's text, and a name may hold a cd into the root (`cd;cd .playground;…`)
      ["an eval of a glob", "cd /tmp/g && eval *"],
      ["an eval of a glob under the folder", "cd /tmp/g && eval ./*"],
      ["an eval of a ? glob", "cd /tmp/g && eval ?*"],
      ["an eval of a bracket glob", "cd /tmp/g && eval [c]*"],
      ["an eval of a glob by its path", "eval /tmp/g/*"],
      // a shell option turns more characters into glob operators, so only plain characters read as written
      ["an eval of a zsh extendedglob negation", "cd /tmp/g && setopt extendedglob && eval ^x"],
      ["an eval of a negation by its path after setopt", "setopt extendedglob; eval /tmp/g/^x"],
      ["an eval of a negation by its path after set -o", "set -o extendedglob; eval /tmp/g/^x"],
      ["an eval of a zsh extendedglob repeat", "cd /tmp/g && setopt extendedglob && eval x#"],
      ["an eval of a zsh extendedglob exclusion", "cd /tmp/g && setopt extendedglob && eval x~y"],
      ["an eval of a ksh pattern of one or more", "cd /tmp/g && setopt kshglob && eval +(x)"],
      ["an eval of a ksh pattern of exactly one", "cd /tmp/g && setopt kshglob && eval @(x)"],
      ["an eval of a bash extglob negation", "bash -c 'shopt -s extglob; cd /tmp/g && eval !(x)'"],
      ["an eval of a bash extglob option", "bash -c 'shopt -s extglob; cd /tmp/g && eval ?(x)'"],
    ],
  },
]
