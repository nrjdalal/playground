import { type Group, NEVER_MADE } from "./_shared"

// #1599: an awk program that runs no command and writes no file, on a line a command the hook does not know makes it read whole, which no-extensions-write read as a shell line, and a case whose patterns are paths' globs, which it read as paths, beside the forms that let either write or run, which it still refuses; rows are data, as refused-forms.ts says.
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
        "a case that only echoes, its pattern a path's glob",
        `case "$P" in /*) echo abs ;; *) echo rel ;; esac`,
      ],
      [
        "a case whose alternatives are paths' globs",
        `case "$P" in /a*|/b*) echo y ;; /c*) : ;; esac`,
      ],
      [
        "a case whose branch touches a file in the root",
        `case "$P" in /*) touch ${SCOPE}/x ;; esac`,
      ],
      [
        "a case whose pattern holds a removal in a substitution",
        `case "$P" in $(rm -rf ${NEVER_MADE})) echo y ;; esac`,
      ],
      [
        "a case whose subject holds a removal in a substitution",
        `case "$(rm -rf ${NEVER_MADE})" in /*) echo y ;; esac`,
      ],
      [
        "a case whose output is redirected into the root",
        `case "$P" in /*) echo y ;; esac > ${LIST}`,
      ],
      [
        "a read-only awk that prints a conflict's lines, its regex holding a >",
        "awk '/^<<<<<<< /{p=1} p {print} /^>>>>>>> /{p=0}' a.ts",
      ],
      [
        "an awk program that prints into the root after a regex holding a >",
        `awk '/^>>>>>>> / {print > "${LIST}"}' a.ts`,
      ],
      [
        "an awk program that calls system after a regex holding a >",
        `awk '/^>>>>>>> / {system("rm -rf ${NEVER_MADE}")}' a.ts`,
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
  "a case that only echoes, its pattern a path's glob",
  "a case whose alternatives are paths' globs",
  "a read-only awk that prints a conflict's lines, its regex holding a >",
]
