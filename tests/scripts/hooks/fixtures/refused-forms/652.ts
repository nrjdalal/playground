import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal echoed to sudo's shell behind a shortened user option and its value",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --us root -s",
      ],
      [
        "a removal echoed to sudo's shell behind a one-letter user option and its value",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --u root -s",
      ],
      [
        "a removal echoed to sudo's login shell behind a shortened user option and its value",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --use root --login",
      ],
      [
        "a removal echoed to sudo's shell behind a shortened prompt option and its value",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --pro x -s",
      ],
      [
        "a removal echoed to sudo's shell behind a flag and a shortened user option",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -E --us root -s",
      ],
      [
        "a removal echoed to sudo's shell behind nice and a shortened user option",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | nice sudo --us root -s",
      ],
      [
        "a removal echoed to sudo's shell behind more shortened user options than the parse's readings",
        `echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo ${"--us root ".repeat(16)}--us root -s`,
      ],
      [
        "a removal echoed to sudo's shell behind more shortened prompt options than the parse's readings",
        `echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo ${"--pro x ".repeat(24)}--us root -s`,
      ],
      [
        "a removal echoed to a shell behind sudo and more shortened user options than the parse's readings",
        `echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo ${"--us root ".repeat(17)}bash`,
      ],
      [
        "a removal echoed to a shell behind sudo, more shortened options than the parse's readings and env",
        `echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo ${"--bac x ".repeat(17)}env bash`,
      ],
      [
        "a removal echoed to a shell behind nice and more unlisted options than the parse's readings",
        `echo 'rm -rf ~/.playground/extensions/.no-such-folder' | nice ${"--zz x ".repeat(17)}sh`,
      ],
    ],
  },
]
