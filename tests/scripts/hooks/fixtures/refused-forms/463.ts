import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["rm of a half-quoted brace", "rm -rf {.playground,'x'}/extensions/.no-such-folder"],
      ["a write to a half-quoted glob", "echo x > '.pl'*"],
      ["awk over an unquoted glob in the home", "awk '{print $1}' .pl*"],
      ["awk over a half-quoted glob in the home", "awk '{print $1}' '.pl'*"],
      ["cut over a half-quoted glob in the home", "cut -f1 '.pl'*"],
    ],
  },
]
