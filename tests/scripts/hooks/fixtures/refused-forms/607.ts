import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      ["a commit a root shell runs from a here-string", "sudo -s <<< 'git commit -m x'"],
      ["a commit a root shell runs from a heredoc", "sudo -s <<EOF\ngit commit -m x\nEOF"],
      ["a commit a root shell's login runs from a here-string", "sudo -i <<< 'git commit -m x'"],
      [
        "a here-string a root shell runs from a value the hook cannot read",
        `sudo -s <<< "$(cat ${MAIN}/.no-such-file)"`,
      ],
      [
        "a here-string a shell runs from a value the hook cannot read",
        `sh <<< "$(cat ${MAIN}/.no-such-file)"`,
      ],
      [
        "a heredoc a shell runs around a value the hook cannot read",
        `sh <<EOF\n$(cat ${MAIN}/.no-such-file)\nEOF`,
      ],
      ["a heredoc a shell runs around a variable the hook cannot read", "bash <<EOF\n$SCRIPT\nEOF"],
    ],
  },
]
