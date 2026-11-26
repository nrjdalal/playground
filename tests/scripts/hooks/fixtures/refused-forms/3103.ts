import { type Group } from "./_shared"

// #3103: a shell reads stdin through any spelling of its path the kernel reads as the same file, a ./ hop or a doubled slash; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: ({ LIST }) => [
      ["bash reading /dev/stdin through a ./ hop", `bash /./dev/stdin <<< 'touch ${LIST}'`],
      ["bash reading /dev/stdin through a doubled slash", `bash /dev//stdin <<< 'touch ${LIST}'`],
      ["source of /dev/fd/0 through a ./ hop", `source /dev/./fd/0 <<< 'touch ${LIST}'`],
    ],
  },
]
