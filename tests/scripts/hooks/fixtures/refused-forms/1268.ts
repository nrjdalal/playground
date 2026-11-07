import { type Group } from "./_shared"

// An unquoted plain parameter may split at zsh's top level and in zsh -c, whatever else the line runs; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["ln of one variable at zsh's top level", "ln -s $X"],
      ["GNU ln of one variable at zsh's top level", "gln -s $X"],
      ["dd with a variable after if= at zsh's top level", "dd if=$X"],
      ["mkdir with a mode from a variable at zsh's top level", "mkdir -m $X /tmp/x"],
      ["ln of one variable in zsh -c", `zsh -c 'ln -s $X'`],
      ["dd with an arithmetic block size", "dd if=/dev/zero of=/tmp/y bs=$((4 * 1024)) count=1"],
      ["ln of a variable after an npx -y", "npx -y cowsay hi; ln -s $X"],
      ["ln of a variable after a find -type", "find . -type f -name a; ln -s $X"],
      ["ln after a source behind an attached redirect", ">/tmp/o source /tmp/f; ln -s $X"],
      ["ln after a source behind a redirect of stderr", "2>/dev/null source /tmp/f; ln -s $X"],
      ["ln after a source behind a spaced redirect", "< /tmp/i source /tmp/f; ln -s $X"],
      ["ln after a source repeat runs", "repeat 2 source /tmp/f; ln -s $X"],
      [
        "ln after a comment's apostrophe and a source behind a prefix with a quoted space",
        `# it's\nA="a b" source /tmp/f; ln -s $X`,
      ],
      [
        "ln after a comment's apostrophe and a source in ANSI-C quotes",
        `# it's\n$'source' /tmp/f; ln -s $X`,
      ],
      ["ln after a function the shell may autoload", "promptinit; ln -s $X"],
      [
        "ln after a source behind a backtick prefix with a space",
        "A=`echo a b` source /tmp/f; ln -s $X",
      ],
    ],
  },
]
