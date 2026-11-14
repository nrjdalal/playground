import type { Group } from "./_shared"

// #2158: an xargs replace string (BSD -J, GNU -I, -i, --replace) spelled as a word in xargs' program position, so xargs runs the input line in that word's place, a program the guard never read; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "ext add by a program xargs -J puts in place of the typed one",
        `echo playground | xargs -J cat cat ext add login list x y`,
      ],
      [
        "ext add by a program an attached xargs -J puts in place of the typed one",
        `echo playground | xargs -Jcat cat ext add login list x y`,
      ],
      [
        "ext add by a program xargs -I puts in place of the typed one",
        `echo playground | xargs -I cat cat ext add login list x y`,
      ],
      [
        "ext add by a program an attached xargs -I puts in place of the typed one",
        `echo playground | xargs -Icat cat ext add login list x y`,
      ],
      [
        "ext add by a program xargs -i puts in place of the typed one",
        `echo playground | xargs -icat cat ext add login list x y`,
      ],
      [
        "ext add by a program xargs --replace= puts in place of the typed one",
        `echo playground | xargs --replace=cat cat ext add login list x y`,
      ],
      [
        "ext add by a program xargs -J puts in place of a wrapper's name",
        `echo playground | xargs -J nice nice ext add login list x y`,
      ],
      [
        "ext add by the program a bare xargs -i puts in place of its default {}",
        `echo playground | xargs -i {} ext add login list x y`,
        "checkout",
      ],
      [
        "ext add by the program a bare xargs --replace puts in place of its default {}",
        `echo playground | xargs --replace {} ext add login list x y`,
        "checkout",
      ],
      [
        "ext add by a program xargs -J puts in place of the word env -S splits",
        `echo playground | xargs -J cat env -S cat ext add login list x y`,
      ],
      [
        "ext add by a program xargs -I puts in the string env -S splits",
        `echo playground | xargs -I cat env -S 'cat ext add login list x y'`,
      ],
      [
        "ext add by a program xargs -I puts in an attached env -S string",
        `echo playground | xargs -I cat env -Scat ext add login list x y`,
      ],
      [
        "ext add by a program xargs --replace= puts in env's --split-string=",
        `echo playground | xargs --replace=cat env --split-string=cat ext add login list x y`,
      ],
      [
        "ext add by a program xargs -I puts in a string an env -S inside env -S splits",
        `echo playground | xargs -I cat env -S 'env -S cat' ext add login list x y`,
      ],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      [
        "a build in the main checkout by a program xargs -J puts in place of the typed one",
        "echo turbo | xargs -J cat cat run build",
      ],
      [
        "a build in the main checkout by a program an attached xargs -J puts in place of the typed one",
        "echo turbo | xargs -Jcat cat run build",
      ],
      [
        "a build in the main checkout by a program xargs -I puts in place of the typed one",
        "echo turbo | xargs -I cat cat run build",
      ],
      [
        "a build in the main checkout by a program an attached xargs -I puts in place of the typed one",
        "echo turbo | xargs -Icat cat run build",
      ],
      [
        "a build in the main checkout by a program xargs -i puts in place of the typed one",
        "echo turbo | xargs -icat cat run build",
      ],
      [
        "a build in the main checkout by a program xargs --replace= puts in place of the typed one",
        "echo turbo | xargs --replace=cat cat run build",
      ],
      [
        "a build in the main checkout by a program xargs -J puts in place of a wrapper's name",
        "echo turbo | xargs -J nice nice run build",
      ],
      [
        "a build in the main checkout by the program a bare xargs -i puts in place of its default {}",
        "echo turbo | xargs -i {} run build",
      ],
      [
        "a build in the main checkout by the program a bare xargs --replace puts in place of its default {}",
        "echo turbo | xargs --replace {} run build",
      ],
      [
        "a build in the main checkout by a program xargs -J puts in place of the word env -S splits",
        `echo turbo | xargs -J cat env -S cat run build`,
      ],
      [
        "a build in the main checkout by a program xargs -I puts in the string env -S splits",
        `echo turbo | xargs -I cat env -S 'cat run build'`,
      ],
      [
        "a build in the main checkout by a program xargs -I puts in an attached env -S string",
        `echo turbo | xargs -I cat env -Scat run build`,
      ],
      [
        "a build in the main checkout by a program xargs --replace= puts in env's --split-string=",
        `echo turbo | xargs --replace=cat env --split-string=cat run build`,
      ],
      [
        "a build in the main checkout by a program xargs -I puts in a string an env -S inside env -S splits",
        `echo turbo | xargs -I cat env -S 'env -S cat' run build`,
      ],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-unslotted-run"],
    rows: () => [
      [
        "an unslotted build by a program xargs -J puts in place of the typed one",
        "echo turbo | xargs -J cat cat run build",
      ],
      [
        "an unslotted build by a program an attached xargs -J puts in place of the typed one",
        "echo turbo | xargs -Jcat cat run build",
      ],
      [
        "an unslotted build by a program xargs -I puts in place of the typed one",
        "echo turbo | xargs -I cat cat run build",
      ],
      [
        "an unslotted build by a program an attached xargs -I puts in place of the typed one",
        "echo turbo | xargs -Icat cat run build",
      ],
      [
        "an unslotted build by a program xargs -i puts in place of the typed one",
        "echo turbo | xargs -icat cat run build",
      ],
      [
        "an unslotted build by a program xargs --replace= puts in place of the typed one",
        "echo turbo | xargs --replace=cat cat run build",
      ],
      [
        "an unslotted build by a program xargs -J puts in place of a wrapper's name",
        "echo turbo | xargs -J nice nice run build",
      ],
      [
        "an unslotted build by the program a bare xargs -i puts in place of its default {}",
        "echo turbo | xargs -i {} run build",
      ],
      [
        "an unslotted build by the program a bare xargs --replace puts in place of its default {}",
        "echo turbo | xargs --replace {} run build",
      ],
    ],
  },
]
