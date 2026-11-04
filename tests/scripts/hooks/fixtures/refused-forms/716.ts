import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal echoed to sudo's shell named inside env's split string",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | env -S 'sudo -s'",
      ],
      [
        "a removal echoed to sudo's shell behind a shortened user option inside env's split string",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | env -S 'sudo --us root -s'",
      ],
      [
        "a removal echoed to sudo's shell inside env's long split-string option",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | env --split-string='sudo -s'",
      ],
      [
        "a removal echoed to a shell told by a lone dash to read stdin",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sh -",
      ],
      [
        "a removal echoed to a root shell told by a lone dash to read stdin",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo sh -",
      ],
      [
        "a removal echoed to a root shell with a lone dash behind sudo's flag",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -E sh -",
      ],
      [
        "a removal echoed to a root shell with a lone dash behind a shortened user option",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --us root sh -",
      ],
      [
        "a removal echoed to a root shell with a lone dash behind nice",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | nice sudo sh -",
      ],
      [
        "a removal echoed to a root shell with a lone dash behind time",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | time sudo sh -",
      ],
      [
        "a removal echoed to a root shell with a lone dash behind timeout",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | timeout 5 sudo sh -",
      ],
      [
        "a removal echoed to a root shell with a lone dash behind stdbuf",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | stdbuf -o0 sudo sh -",
      ],
      [
        "a removal echoed to a root shell with a lone dash behind command",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | command sudo sh -",
      ],
      [
        "a here-string to a root shell told by a lone dash to read stdin",
        "sudo sh - <<< 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a removal echoed to busybox's shell applet",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | busybox sh",
      ],
      [
        "a removal echoed to busybox's shell applet behind sudo",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo busybox sh",
      ],
      [
        "a removal echoed to busybox's shell applet behind nice and sudo",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | nice sudo busybox sh",
      ],
    ],
  },
]
