import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a delete behind sudo, its -p value in a cluster",
        "sudo -Hp wc watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind sudo --prompt",
        "sudo --prompt wc watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind time -o",
        "/usr/bin/time -o cat watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind doas -a",
        "doas -a wc watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind doas -C",
        "doas -C wc watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind a sudo option it does not know",
        "sudo -Z wc watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind time -o's value in a variable",
        "/usr/bin/time -o $F cat watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind sudo, its -p value attached",
        "sudo -pwc watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind sudo --prompt=",
        "sudo --prompt=wc watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind time, its -o value attached",
        "/usr/bin/time -ocat watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind sudo's options and --",
        "sudo -Hp wc -- watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a delete behind nice's -<number>",
        "nice -10 watch 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a file name piped to sudo's shell",
        "cut 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -s",
      ],
      [
        "a removal printed to doas's shell",
        `awk 'BEGIN{print "rm -rf ~/.playground/extensions/.no-such-folder"}' | doas -s`,
      ],
      [
        "a removal printed to sudo's login shell",
        `awk 'BEGIN{print "rm -rf ~/.playground/extensions/.no-such-folder"}' | sudo -i`,
      ],
      [
        "a removal printed to a reader-named function running sudo's shell",
        `function grep { sudo -s; }; awk 'BEGIN{print "rm -rf ~/.playground/extensions/.no-such-folder"}' | grep x`,
      ],
      [
        "a removal printed to sudo with its user in a variable",
        `awk 'BEGIN{print "rm -rf ~/.playground/extensions/.no-such-folder"}' | sudo -u $U`,
      ],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-stash"],
    rows: () => [
      ["a stash behind sudo, its -p value in a cluster", "sudo -Hp echo git stash"],
      ["a stash behind sudo --prompt", "sudo --prompt echo git stash"],
      ["a stash behind time -o", "/usr/bin/time -o echo git stash"],
      ["a stash behind doas -a", "doas -a echo git stash"],
      ["a stash behind a sudo option it does not know", "sudo -Z echo git stash"],
      ["a stash pop in a shell behind nice's -<number>", "nice -10 sh -c 'git stash pop'"],
      ["a stash behind nice -n with its value in a variable", "nice -n $N git stash"],
      ["a stash behind a timeout option it does not know", "timeout -Q 5 git stash"],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      ["a commit behind nice's -<number>", `nice -10 git -C ${MAIN} commit -m x`],
      [
        "a commit behind nice -n with its value in a variable",
        `nice -n $N git -C ${MAIN} commit -m x`,
      ],
      [
        "a commit behind sudo -u with its value in a variable",
        `sudo -u $U git -C ${MAIN} commit -m x`,
      ],
      ["a commit behind a sudo option it does not know", `sudo -Z git -C ${MAIN} commit -m x`],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-kill-by-name"],
    rows: () => [
      ["pkill by pattern behind nice's -<number>", "nice -10 pkill -f x"],
      ["pkill by pattern behind a timeout option it does not know", "timeout -Q 5 pkill -f x"],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-env-dump"],
    rows: () => [
      ["printenv behind nice's -<number>", "nice -10 printenv"],
      ["printenv behind a sudo option it does not know", "sudo -Z printenv"],
    ],
  },
]
