import { type Group, NEVER_MADE } from "./_shared"

// #1599: an awk program that runs no command and writes no file, on a line a command the hook does not know makes it read whole, which no-extensions-write read as a shell line, beside the four forms that let a program write or run, which it still refuses; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home", "tmp"],
    guards: ["no-extensions-write"],
    rows: ({ LIST, SCOPE }) => [
      // its ~ expands to the process's home, which holds the root, when the program is read as a shell line
      [
        "a read-only awk filter on a piped line",
        `echo 'a b c d unix' | awk '$5 ~ /unix/'`,
        "process home",
      ],
      ["a read-only awk print on a piped line", `lsof -U | awk '{print $2}'`, "home"],
      [
        "an awk program that prints into the root on a piped line",
        `echo x | awk '{print > "${LIST}"}'`,
      ],
      [
        "an awk program that appends into the root on a piped line",
        `echo x | awk '{print >> "${LIST}"}'`,
      ],
      [
        "an awk program that pipes into a shell on a piped line",
        `echo x | awk '{print "rm -rf ${NEVER_MADE}" | "sh"}'`,
      ],
      [
        "an awk program that calls system on a piped line",
        `echo x | awk '{system("rm -rf ${NEVER_MADE}")}'`,
      ],
      [
        "an awk program whose getline reads from a command on a piped line",
        `echo x | awk 'BEGIN {"rm -rf ${NEVER_MADE}" | getline}'`,
      ],
      [
        "an awk program from a -f file in the root on a piped line",
        `echo x | awk -f ${SCOPE}/x.awk`,
      ],
      [
        "a read-only awk program whose output a shell runs",
        `echo x | awk '{print "rm -rf ${NEVER_MADE}"}' | sh`,
      ],
    ],
  },
]

export const allowed: string[] = [
  "a read-only awk filter on a piped line",
  "a read-only awk print on a piped line",
]
