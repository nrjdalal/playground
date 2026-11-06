import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal echoed to sudo's shell, its user option after it in a cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -su root",
      ],
      [
        "a removal echoed to sudo's login shell, its user option after it in a cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -iu root",
      ],
      [
        "a removal echoed to sudo's shell inside a longer cluster before its user option",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -Esu root",
      ],
      [
        "a removal echoed to sudo's shell, its user value attached in the cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -suroot",
      ],
      [
        "a removal echoed to doas's shell, its user option after it in a cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | doas -su root",
      ],
      [
        "a removal in a here-string to sudo's shell, its user option after it in a cluster",
        "sudo -su root <<< 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a removal echoed to sudo's shell, its user value a uid attached in the cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -su#0",
      ],
      [
        "a removal echoed to sudo's shell, its user value a digit attached in the cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -su0",
      ],
      [
        "a removal echoed to sudo's shell, its user value holding an underscore",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -su_www",
      ],
      [
        "a removal echoed to sudo's shell, its user value holding a dot",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -suroot.x",
      ],
      [
        "a removal echoed to sudo's shell, its close-from value attached in the cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -sC3",
      ],
      [
        "a removal echoed to sudo's shell, its chdir value a path attached in the cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -sD/tmp",
      ],
      [
        "a removal echoed to sudo's login shell, its user value a uid attached in the cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo -iu#0",
      ],
      [
        "a removal echoed to doas's shell, its user value a uid attached in the cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | doas -su#0",
      ],
      [
        "a removal in a here-string to sudo's shell, its user value a uid attached in the cluster",
        "sudo -su#0 <<< 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a removal echoed to sudo's shell behind nice, its user option after it in a cluster",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | nice sudo -su root",
      ],
      [
        "a removal echoed to sudo's shell behind env, its user value a uid attached",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | env sudo -su#0",
      ],
    ],
  },
]
