import { type Folder, type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => {
      const from: [Folder, string, string[]][] = [
        [
          "extensions root",
          "",
          ["acme", "extensions/acme", ".playground/extensions/acme", "../extensions/acme"],
        ],
        [
          "data folder",
          "",
          ["extensions/acme", ".playground/extensions/acme", "../extensions/acme"],
        ],
        ["home", "", [".playground/extensions/acme"]],
        [
          "home",
          "/.playground",
          ["extensions/acme", ".playground/extensions/acme", "../extensions/acme"],
        ],
      ]
      return [
        ...["~-", "~+"].flatMap((tilde) =>
          from.flatMap(([folder, tail, paths]) =>
            paths.map(
              (path) =>
                [
                  `pushd ${tilde}${tail} from the ${folder} before rm of ${path}`,
                  `pushd ${tilde}${tail}; rm -rf ${path}`,
                  folder,
                ] as const,
            ),
          ),
        ),
        [
          "pushd ~- beside a folder named ~-, read as typed",
          `cd /tmp; cd ${ROOT}/hooks; pushd ~-; rm -rf acme`,
        ],
        [
          "pushd ~+ beside a folder named ~+, read as typed",
          `cd ${ROOT}/hooks; pushd ~+/../..; rm -rf acme`,
        ],
        ["a glob in cd's folder", "cd .playground/e*; rm -rf login"],
        ["a glob in pushd's folder", "pushd .playground/ext?nsions; rm -rf login"],
      ]
    },
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      ["pushd ~+ before a build", "pushd ~+; bun run build"],
      ["pushd ~+ before a commit", "pushd ~+; git commit -m x"],
    ],
  },
]
