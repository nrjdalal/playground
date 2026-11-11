import { type Group } from "./_shared"

// #1657: date, true, a jq read and a bash -c of a read join the closed list and a plain getline runs nothing, so a reader beside them is read call by call; these are the forms beside them that still write, run or eval, which stay refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home", "data folder", "checkout"],
    guards: ["no-extensions-write"],
    rows: ({ LIST }) => [
      ["an in-place sed on a list on a line read whole", `sed -i '' 's/a/b/' ${LIST}; true`],
      ["an in-place sed on a list under bash -c", `/bin/bash -c 'sed -i "" "s/a/b/" ${LIST}'`],
      ["a sed w command into a list on a line read whole", `sed -n 'w ${LIST}' f; true`],
      ["a sed w command into a list under bash -c", `/bin/bash -c 'sed -n "w ${LIST}" f'`],
      ["an awk print into a list on a line read whole", `awk '{print > "${LIST}"}' f; true`],
      ["an awk system() on a line read whole", `awk 'BEGIN{system("touch ${LIST}")}'; true`],
      ["an awk getline from a command", `awk 'BEGIN { "touch ${LIST}" | getline }'`],
      ["a sed read redirected into a list", `sed -n '/{/p' f > ${LIST}; true`],
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
]
