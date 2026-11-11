import { type Group } from "./_shared"

// #1657: date, a jq read and a bash -c of a read join the closed list and a plain getline runs nothing, so a reader beside them is read call by call; these are the forms beside them that still write, run or eval, which stay refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home", "data folder", "checkout"],
    guards: ["no-extensions-write"],
    rows: ({ LIST }) => [
      ["an in-place sed on a list on a line read whole", `sed -i '' 's/a/b/' ${LIST}; date`],
      ["an in-place sed on a list under bash -c", `/bin/bash -c 'sed -i "" "s/a/b/" ${LIST}'`],
      ["a sed w command into a list on a line read whole", `sed -n 'w ${LIST}' f; date`],
      ["a sed w command into a list under bash -c", `/bin/bash -c 'sed -n "w ${LIST}" f'`],
      ["an awk print into a list on a line read whole", `awk '{print > "${LIST}"}' f; date`],
      ["an awk system() on a line read whole", `awk 'BEGIN{system("touch ${LIST}")}'; date`],
      ["an awk getline from a command", `awk 'BEGIN { "touch ${LIST}" | getline }'`],
      ["a sed read redirected into a list", `sed -n '/{/p' f > ${LIST}; date`],
      [
        "a gh jq filter redirected into a list",
        `gh api repos/o/r/pulls --jq '.[] | "\\(.a)/\\(.b)"' > ${LIST}; date`,
      ],
      ["a sed read piped into a shell", `sed -n '/{/p' f | sh`],
      // eval runs whatever the file prints, which the hook cannot read, so the issue's eval forms stay refused on purpose
      ["an eval of a sed read", `eval "$(sed -n "/^switch_ends() {/,/^}/p" f)"`],
      [
        "an eval of a sed read under bash -c",
        `/bin/bash -c 'eval "$(sed -n "/^switch_ends() {/,/^}/p" f)"'`,
      ],
    ],
  },
  // a line holding text the shell runs as code where the lexer reads a plain word keeps canary's closed list, so a sed or awk read beside one keeps canary's reading
  {
    folders: ["home", "data folder"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["a sed read beside date and an e parameter flag", "sed -n '/{/p' f; date ${(e)x}"],
      ["a sed read after date and a glob substitution", "date ${~x}; sed -n '/{/p' f"],
      ["a sed read beside date and arithmetic over a name", "sed -n '/{/p' f; date $((x))"],
      ["a sed read beside date and an e glob qualifier", "sed -n '/{/p' f; date f(e:x:)"],
      ["a sed read after jq over a subscript", `jq . "\${a[x]}"; sed -n '/{/p' f`],
      ["an awk getline over a subscript", `awk '/{/{getline; print}' "\${a[x]}"`],
      ["an awk getline beside a prompt expansion", "awk '/{/{getline; print}' f; date ${x@P}"],
      ["a bash -c read beside arithmetic over a name", `bash -c 'sed -n "/{/p" f; date $((x))'`],
      ["a bash -c read beside a prompt expansion", `bash -c 'sed -n "/{/p" f; date \${x@P}'`],
    ],
  },
]
