import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["ln of a variable after a sourced file", "source /tmp/f; ln -s $X"],
      ["ln of a variable after a sourced file in zsh -c", `zsh -c 'source /tmp/f; ln -s $X'`],
      ["ln of zsh's region_highlight array", "ln -s $region_highlight"],
      ["dd of zsh's completion words array", "dd if=$words"],
      ["dd of zsh's compstate hash", "dd if=$compstate"],
      ["dd of zsh's killring array", "dd if=$killring"],
    ],
  },
  {
    // in the home folder the guard already refuses `.`, which it reads as a path naming the folder that holds the extensions root
    folders: ["checkout"],
    guards: ["no-extensions-write"],
    rows: () => [["ln of a variable after a dot-sourced file", ". /tmp/f; ln -s $X"]],
  },
]
