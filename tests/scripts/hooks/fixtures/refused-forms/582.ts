import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal echoed to sudo's shell flag in single quotes",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo '-s'",
      ],
      [
        "a removal echoed to sudo's shell letter in single quotes after its dash",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -'s'",
      ],
      [
        "a removal echoed to sudo's login flag in single quotes",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo '-i'",
      ],
      [
        "a removal echoed to sudo's shell long option in single quotes",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo '--shell'",
      ],
      [
        "a removal echoed to sudo's shell, its cluster in double quotes before its user value",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo \"-su\" root",
      ],
      [
        "a removal echoed to sudo's shell, its cluster in single quotes before its user value",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo '-su' root",
      ],
      [
        "a removal echoed to sudo's shell, its cluster's user letter quoted",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -s'u' root",
      ],
      [
        "a removal echoed to sudo's shell, its attached user value in single quotes",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -su'root'",
      ],
      [
        "a removal echoed to sudo's shell, its attached user value in double quotes",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -su\"root\"",
      ],
      [
        "a removal echoed to sudo's shell, its attached user value holding an escaped space",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -su\\ x",
      ],
      [
        "a removal echoed to doas's shell flag in single quotes",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | doas '-s'",
      ],
      [
        "a removal echoed to doas's shell letter in single quotes after its dash",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | doas -'s'",
      ],
      [
        "a removal echoed to doas's shell, its cluster in double quotes before its user value",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | doas \"-su\" root",
      ],
      [
        "a removal echoed to doas's shell, its attached user value in single quotes",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | doas -su'root'",
      ],
      [
        "a removal echoed to doas's shell, its attached user value in double quotes",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | doas -su\"root\"",
      ],
      [
        "a removal in a here-string to sudo's shell, its attached user value quoted",
        "sudo -su'root' <<< 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a removal echoed to a quoted sudo's shell flag",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | 'sudo' -s",
      ],
      [
        "a removal echoed to a double-quoted sudo's shell, its user option after it in a cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | \"sudo\" -su root",
      ],
      [
        "a removal echoed to a quoted sudo's shell flag behind nice",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | nice 'sudo' -s",
      ],
      [
        "a removal echoed to sudo's login flag behind a quoted doas",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | 'doas' sudo -i",
      ],
      [
        "a removal echoed to sudo's login long option behind a quoted doas",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | 'doas' sudo --login",
      ],
      [
        "a removal echoed to sudo's shell in a cluster behind a quoted doas",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | 'doas' sudo -Es",
      ],
      [
        "a removal echoed to sudo's login flag behind an escaped doas",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | \\doas sudo -i",
      ],
      [
        "a removal in a here-string to sudo's login flag behind a quoted doas",
        "'doas' sudo -i <<< 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a removal echoed to doas's shell in a cluster behind a quoted sudo",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | 'sudo' doas -Ls",
      ],
      [
        "a removal echoed to sudo's login flag behind doas",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | doas sudo -i",
      ],
      [
        "a removal echoed to doas's shell in a cluster behind sudo",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo doas -Ls",
      ],
      [
        "a removal echoed to sudo's shell, its attached user value a path ending in sudo",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -su/usr/bin/sudo",
      ],
      [
        "a removal echoed to sudo's login shell, its attached user value a path ending in doas",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -iu/x/doas",
      ],
      [
        "a removal echoed to sudo's shell, its attached chdir value a path ending in sudo",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -sD/sudo",
      ],
      [
        "a removal echoed to doas's shell, its attached user value a path ending in doas",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | doas -su/doas",
      ],
      [
        "a removal echoed to sudo given an unread word ending in sudo",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo \"$X\"/sudo",
      ],
      [
        "a removal echoed to sudo's shell, its cluster's value an unread word ending in doas",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -s\"$X\"/doas",
      ],
    ],
  },
]
