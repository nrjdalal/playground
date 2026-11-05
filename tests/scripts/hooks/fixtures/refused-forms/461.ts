import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home", "data folder"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["sed -i editing in place", "sed -i 's/a/b/' ~/.playground/extensions/.no-such-folder/x.md"],
      [
        "sed -i with a backup suffix attached",
        "sed -i.bak 's/a/b/' ~/.playground/extensions/.no-such-folder/x.md",
      ],
      ["sed -i in a flag cluster", "sed -ni 'p' ~/.playground/extensions/.no-such-folder/x.md"],
      [
        "sed --in-place with a suffix",
        "sed --in-place=.b 's/a/b/' ~/.playground/extensions/.no-such-folder/x.md",
      ],
      ["sed's w command", "sed -n 'w ~/.playground/extensions/.no-such-folder/x' notes.md"],
      [
        "sed's W command after an address",
        "sed -n '/a/W ~/.playground/extensions/.no-such-folder/x' notes.md",
      ],
      ["sed's s/// w flag", "sed 's/a/b/w ~/.playground/extensions/.no-such-folder/x' notes.md"],
      [
        "sed's s/// e flag",
        "sed 's|.*|rm -rf ~/.playground/extensions/.no-such-folder|e' notes.md",
      ],
      ["sed's e command", "sed -n '1e rm -rf ~/.playground/extensions/.no-such-folder' notes.md"],
      [
        "sed's script read from a variable",
        "S='w ~/.playground/extensions/.no-such-folder/x'; sed -n \"$S\" notes.md",
      ],
      [
        "sed printing a command into a shell",
        "sed -n 's|a|rm -rf ~/.playground/extensions/.no-such-folder|p' notes.md | sh",
      ],
      [
        "perl -i editing in place",
        "perl -i -pe 's/a/b/' ~/.playground/extensions/.no-such-folder/x.md",
      ],
      [
        "perl's system()",
        "perl -ne 'system(\"rm -rf ~/.playground/extensions/.no-such-folder\")' notes.md",
      ],
      ["perl's unlink", "perl -e 'unlink \"~/.playground/extensions/.no-such-folder/x\"'"],
      [
        "perl's code block inside a regex",
        "perl -ne 'print if /(?{ system(\"rm -rf ~/.playground/extensions/.no-such-folder\") })/' notes.md",
      ],
      [
        "perl's string interpolating a command",
        "perl -ne 'print \"@{[ qx(rm -rf ~/.playground/extensions/.no-such-folder) ]}\"' notes.md",
      ],
      [
        "perl with PERL5OPT set",
        "PERL5OPT=-Mx perl -ne 'print if /a/' ~/.playground/extensions/.no-such-folder/x.md",
      ],
      [
        "perl -n opening an operand that ends in a pipe",
        "perl -ne 'print if /a/' 'rm -rf ~/.playground/extensions/.no-such-folder|'",
      ],
      [
        "perl -n opening an operand that starts with a pipe",
        "perl -ne 'print if /a/' '|rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "git with a pager set by -c, before an awk",
        "git -c core.pager='rm -rf ~/.playground/extensions/.no-such-folder' log | awk '/a/'",
      ],
      [
        "git with a pager set by GIT_PAGER, before an awk",
        "GIT_PAGER='rm -rf ~/.playground/extensions/.no-such-folder' git log | awk '/a/'",
      ],
      [
        "git log writing its output into the root, before an awk",
        "git log --output=~/.playground/extensions/.no-such-folder/x | awk '/a/'",
      ],
      [
        "git given a word the hook cannot read, before an awk whose regex reads as a glob",
        "git log \"$REV\" | awk '/^a(b)/'",
      ],
      [
        "perl's output redirected into the root",
        "perl -ne 'print if /a/' notes.md > ~/.playground/extensions/.no-such-folder/x",
        "process home",
      ],
    ],
  },
]
