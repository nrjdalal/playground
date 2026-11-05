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
      ["a write under ~- whose slash is quoted", `cd ${SCOPE}; cd /usr; touch ~-"/f"`],
      [
        "cd ~- with an empty quote back into the root before a write",
        `cd ${SCOPE}; cd /usr; cd ~-""; touch f`,
      ],
      ["a write under ~- followed by an empty quote", `cd ${SCOPE}; cd /usr; touch ~-''/f`],
      ["a write under ~- followed by an escaped slash", `cd ${SCOPE}; cd /usr; touch ~-\\/f`],
      [
        "a write under ~- followed by an ANSI-C quoted slash",
        `cd ${SCOPE}; cd /usr; touch ~-$'/f'`,
      ],
      ["a write under ~ followed by a quoted -", `cd ${SCOPE}; cd /usr; touch ~"-"/f`],
      ["a write under ~- followed by a variable", `cd ${SCOPE}; cd /usr; touch ~-$Y/f`],
      ["a removal of ~- followed by an empty quote", `cd ${SCOPE}; cd /usr; rm ~-""`],
      ["a cd's redirect to a path under ~-", `cd ${SCOPE}; cd /usr; cd /tmp > ~-/f`],
      ["a pushd's redirect to a path under ~-", `cd ${SCOPE}; cd /usr; pushd /tmp > ~-/f`],
      ["a popd's redirect to a path under ~-", `cd ${SCOPE}; cd /usr; popd > ~-/f`],
      ["a cd's error redirect to a path under ~-", `cd ${SCOPE}; cd /usr; cd /tmp 2> ~-/f`],
      [
        "a removal under ~- in a function called after the cd",
        `f() { rm ~-/login; }; cd ${SCOPE}; cd /usr; f`,
      ],
      ["a write under ~- in a brace group after the cd", `cd ${SCOPE}; cd /usr; { touch ~-/f; }`],
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
    folders: ["checkout", "home"],
    guards: ["no-main-checkout"],
    rows: ({ MAIN }) => [
      [
        "cd ~- back into the main checkout before a build",
        `cd ${MAIN}; cd /usr; cd ~-; bun run build`,
      ],
      ["a commit with -C ~- into the main checkout", `cd ${MAIN}; cd /usr; git -C ~- commit -m x`],
      [
        "a commit with -C ~- and an empty quote into the main checkout",
        `cd ${MAIN}; cd /usr; git -C ~-"" commit -m x`,
      ],
      [
        "a write under ~- whose slash is quoted, in the main checkout",
        `cd ${MAIN}; cd /usr; touch ~-"/f"`,
      ],
    ],
  },
]
