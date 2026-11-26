import type { Group } from "./_shared"

// #3126: a gh pr merge whose -R or --repo and number the call spells literally runs for another organisation's repository, while every form whose repository may be the factory's (acme-labs/demo here, the checkout's origin) stays refused: that repository named, none named in its checkout, a number the hook cannot read (a variable or a loop's word, which gh takes as a pull request URL of any repository), or a repository a variable holds, since the reader keeps an assignment that may not run. Rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-protected-push"],
    rows: () => [
      ["an org merge by -R", "gh pr merge 5 -R acme-blue/app --merge"],
      ["an org merge by --repo", "gh pr merge 5 --repo acme-blue/app --auto --merge"],
      ["an org merge by --repo=", "gh pr merge 5 --repo=acme-blue/app --merge"],
      [
        "an org merge in a loop by -R",
        "for n in 5 6 7; do gh pr merge $n -R acme-blue/app --merge; done",
      ],
      [
        "an org merge in a loop by --repo",
        `for n in 5 6; do gh pr merge "$n" --repo acme-blue/app --auto --merge; done`,
      ],
      [
        "an org merge whose repository the call sets first",
        "r=acme-blue/app && gh pr merge 5 --repo $r --auto --match-head-commit 0123abc",
      ],
      [
        "an org repository set after a false test",
        `false && r=acme-blue/app; gh pr merge 5 --repo "$r"`,
      ],
      [
        "an org repository set in an if that never runs",
        `if false; then r=acme-blue/app; fi; gh pr merge 5 --repo "$r"`,
      ],
      [
        "an org repository set after a true test's or",
        `true || r=acme-blue/app; gh pr merge 5 --repo "$r"`,
      ],
      [
        "an org repository set over this one on a test",
        `r=acme-labs/demo; [ -n "$x" ] && r=acme-blue/app; gh pr merge 5 --repo "$r"`,
      ],
      [
        "an org repository set as the merge's own prefix",
        `r=acme-blue/app gh pr merge 5 --repo "$r"`,
      ],
      ["an org repository set in a subshell", `(r=acme-blue/app); gh pr merge 5 --repo "$r"`],
      ["an org repository set in a pipeline", `r=acme-blue/app | true; gh pr merge 5 --repo "$r"`],
      [
        "an org repository set in a function never called",
        `f() { r=acme-blue/app; }; gh pr merge 5 --repo "$r"`,
      ],
      ["this repository's merge by -R", "gh pr merge 5 -R acme-labs/demo --merge"],
      ["this repository's merge by --repo=", "gh pr merge 5 --repo=acme-labs/demo --merge"],
      [
        "this repository's merge in a loop by --repo",
        "for n in 5 6; do gh pr merge $n --repo acme-labs/demo --auto --merge; done",
      ],
      [
        "this repository's merge in a loop in its checkout",
        "for n in 5 6; do gh pr merge $n --auto --merge; done",
      ],
      [
        "a loop whose list holds this repository's pull request URL",
        "for n in https://github.com/acme-labs/demo/pull/5 6; do gh pr merge $n -R acme-blue/app --merge; done",
      ],
      [
        "a loop whose list the hook cannot read",
        `for n in $(cat list); do gh pr merge $n -R acme-blue/app --merge; done`,
      ],
      ["a number the hook cannot read", `gh pr merge "$N" -R acme-blue/app --merge`],
      [
        "a loop variable its body sets again",
        `for n in 5 6; do n=$(cat next); gh pr merge $n -R acme-blue/app --merge; done`,
      ],
      ["this repository set first", "r=acme-labs/demo && gh pr merge 5 --repo $r --merge"],
    ],
  },
]

// An org merge runs when the call spells its repository and number literally.
export const allowed = ["an org merge by -R", "an org merge by --repo", "an org merge by --repo="]
