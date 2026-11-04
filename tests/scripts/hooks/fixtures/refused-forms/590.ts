import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal echoed to sudo's shell long option shortened to two letters",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --sh",
      ],
      [
        "a removal echoed to sudo's shell long option shortened to three letters",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --she",
      ],
      [
        "a removal echoed to sudo's shell long option shortened to four letters",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --shel",
      ],
      [
        "a removal echoed to sudo's login long option shortened to two letters",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --lo",
      ],
      [
        "a removal echoed to sudo's login long option shortened to three letters",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --log",
      ],
      [
        "a removal echoed to sudo's login long option shortened to four letters",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --logi",
      ],
      [
        "a removal echoed to sudo's shortened shell long option before its user option",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo --sh -u root",
      ],
      [
        "a removal echoed to sudo's shortened login long option after a flag",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -E --lo",
      ],
      [
        "a removal echoed to sudo's shortened shell long option in single quotes",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo '--sh'",
      ],
      [
        "a removal in a here-string to sudo's shortened shell long option",
        "sudo --sh <<< 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a removal echoed to sudo's shortened login long option behind nice",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | nice sudo --lo",
      ],
    ],
  },
]
