import { type Group, NEVER_MADE } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal echoed to su's root shell",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | su",
      ],
      [
        "a removal echoed to su's root shell for a named user",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | su root",
      ],
      [
        "a removal echoed to su's login shell",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | su -",
      ],
      [
        "a removal echoed to su's login shell for a named user",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | su -l root",
      ],
      [
        "a removal echoed to su's root shell named by its shell option",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | su -s /bin/sh",
      ],
      [
        "a removal echoed to su's root shell named by its shell option for a named user",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | su -s /bin/sh root",
      ],
      [
        "a removal echoed to su's root shell named by its long shell option",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | su --shell=/bin/sh root",
      ],
      [
        "a removal echoed to su's root shell behind sudo",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo su",
      ],
      [
        "a removal echoed to su's root shell behind nice",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | nice su",
      ],
      [
        "a removal echoed to busybox's su applet",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | busybox su",
      ],
      [
        "a removal echoed to busybox's su applet for a named user",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | busybox su root",
      ],
      [
        "a removal echoed to busybox's su applet with its shell option",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | busybox su -s /bin/sh",
      ],
      [
        "a removal echoed to busybox's su applet behind sudo",
        "echo 'rm -rf ~/.playground/extensions/.no-such-folder' | sudo busybox su",
      ],
    ],
  },
  {
    folders: ["checkout", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      ["a recursive delete echoed to su's root shell", `echo 'rm -rf ${NEVER_MADE}' | su`],
      [
        "a recursive delete echoed to busybox's su applet with its shell option",
        `echo 'rm -rf ${NEVER_MADE}' | busybox su -s /bin/sh`,
      ],
      ["a recursive delete in a here-string to su's root shell", `su <<< 'rm -rf ${NEVER_MADE}'`],
    ],
  },
]
