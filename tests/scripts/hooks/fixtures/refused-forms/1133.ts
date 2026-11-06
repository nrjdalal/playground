import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["ln of one unquoted variable bash splits", `bash -c 'ln -s $X'`],
      ["GNU ln of one unquoted variable sh splits", `sh -c 'gln -s $X'`],
      ["dd with an unquoted variable sh splits after if=", `sh -c 'dd if=$X'`],
      ["mkdir with an unquoted mode bash splits", `bash -c 'mkdir -m $X /tmp/x'`],
      [
        "GNU install with an unquoted mode bash splits",
        `bash -c 'ginstall -m $X /etc/hosts /tmp/x'`,
      ],
      ["ln of one unquoted variable dash splits", `dash -c 'ln -s $X'`],
      ["ln of one unquoted variable in a here-string bash runs", `bash <<< 'ln -s $X'`],
    ],
  },
]
