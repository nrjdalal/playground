import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  // a cd the shell may run more than once climbs from wherever its last run left it, so from a worktree three folders below the main checkout it may reach the main checkout
  {
    folders: ["checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      [
        "a commit after a function whose cd climbs, called three times",
        "f() { cd ..; }; f; f; f; git commit -m x",
      ],
      [
        "a commit after a function whose cd climbs, called in a loop",
        "f() { cd ..; }; for i in 1 2 3; do f; done; git commit -m x",
      ],
      [
        "a commit after a function whose cd climbs, called by itself",
        "f() { cd ..; [ -d .git ] || f; }; f; git commit -m x",
      ],
      [
        "a commit after a while loop whose condition climbs",
        "i=0; while cd .. && [ $i -lt 2 ]; do i=$((i+1)); done; git commit -m x",
      ],
      [
        "a commit after an until loop whose condition climbs",
        "i=0; until ! cd .. || [ $i -ge 2 ]; do i=$((i+1)); done; git commit -m x",
      ],
      [
        "a commit after an eval of a climb in a for loop",
        "for i in 1 2 3; do eval 'cd ..'; done; git commit -m x",
      ],
      ["a commit after an eval of a climb under repeat", "repeat 3 eval 'cd ..'; git commit -m x"],
      [
        "a commit after a climb sourced from a here-string in a for loop",
        "for i in 1 2 3; do source /dev/stdin <<< 'cd ..'; done; git commit -m x",
      ],
      [
        "a commit after a climb through a variable in a for loop",
        "U=..; for i in 1 2 3; do cd $U; done; git commit -m x",
      ],
      [
        "a commit after a climb through a variable under repeat",
        "U=..; repeat 3 cd $U; git commit -m x",
      ],
      [
        "a commit after one cd through a variable that climbs to the main checkout",
        "U=../../..; cd $U; git commit -m x",
      ],
    ],
  },
  // the same forms from the home, after a cd into the worktree the shell is sure of
  {
    folders: ["home"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => {
      const W = `${MAIN}/.claude/worktrees/a`
      return [
        [
          "a commit after a function whose cd climbs, called three times, from the home",
          `cd ${W}; f() { cd ..; }; f; f; f; git commit -m x`,
        ],
        [
          "a commit after a while loop whose condition climbs, from the home",
          `cd ${W}; i=0; while cd .. && [ $i -lt 2 ]; do i=$((i+1)); done; git commit -m x`,
        ],
        [
          "a commit after an eval of a climb in a for loop, from the home",
          `cd ${W}; for i in 1 2 3; do eval 'cd ..'; done; git commit -m x`,
        ],
        [
          "a commit after a climb through a variable in a for loop, from the home",
          `cd ${W}; U=..; for i in 1 2 3; do cd $U; done; git commit -m x`,
        ],
        [
          "a commit after a cd through a variable that names the main checkout, from the home",
          `U=${MAIN}; cd "$U" && git commit -m x`,
        ],
      ]
    },
  },
]
