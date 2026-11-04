import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "data folder", "home"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT, SCOPE }) => [
      ["cd ~- back into the root before a write", `cd ${SCOPE}; cd /usr; cd ~-; touch f`],
      ["cd ~-/.. back into the root before a removal", `cd ${SCOPE}; cd /usr; cd ~-/..; rm login`],
      ["a write to a path under ~-", `cd ${SCOPE}; cd /usr; touch ~-/f`],
      ["a redirect to a path under ~-", `cd ${SCOPE}; cd /usr; echo x > ~-/f`],
      ["a removal of ~- itself", `cd ${SCOPE}; cd /usr; rm ~-`],
      ["a removal under ~- after a pushd", `pushd ${ROOT}; pushd /usr; rm ~-/login`],
      [
        "a removal under a ~- the reader cannot name, after a cd it is unsure of",
        `cd /no-such-folder || cd ${SCOPE}; cd /usr; rm ~-/login`,
      ],
      [
        "pushd -n ~-, which zsh fails, staying in the root",
        `cd /usr; cd ${SCOPE}; pushd -n ~-; touch f`,
      ],
      [
        "pushd ~- ~-, which zsh fails, staying in the root",
        `cd /usr; cd ${SCOPE}; pushd ~- ~-; touch f`,
      ],
      ["cd -n ~-, which zsh fails, staying in the root", `cd /usr; cd ${SCOPE}; cd -n ~-; touch f`],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      [
        "cd ~- back into the main checkout before a build",
        `cd ${MAIN}; cd /usr; cd ~-; bun run build`,
      ],
      ["a commit with -C ~- into the main checkout", `cd ${MAIN}; cd /usr; git -C ~- commit -m x`],
    ],
  },
]
