import { type Group } from "./_shared"

// A reviewer of an outside author's PR running a skill's script by its path, whose shebang runs bun, where bun could read a bunfig.toml the PR holds: in the PR's clone, a subfolder under the clone's own, a subfolder with one of its own, and a folder the hook cannot read; both skill roots, the data folder's installed skills and the main checkout's extensions.
const STATE = "code-review-loop/scripts/state"
const scripts = (data: string, main: string) => ({
  core: `${main}/extensions/core/skills/${STATE}`,
  installed: `${data}/orgs/home/abc123/skills/${STATE}`,
})

export const groups: Group[] = [
  {
    folders: [
      "outside clone",
      "outside clone subfolder",
      "outside clone subfolder with bunfig",
      "unknown folder",
    ],
    guards: ["no-outside-pr-code"],
    rows: ({ DATA, MAIN }) => {
      const { core, installed } = scripts(DATA, MAIN)
      return [
        [
          "an installed skill's bun script by its path",
          `${installed}.ts pr acme-owner/widgets 501`,
        ],
        ["a core skill's bun script by its path", `${core}.ts pr acme-owner/widgets 501`],
      ]
    },
  },
  {
    folders: ["outside clone"],
    guards: ["no-outside-pr-code"],
    rows: ({ DATA, MAIN }) => {
      const { core, installed } = scripts(DATA, MAIN)
      return [
        [
          "an installed skill's bun script from the main checkout",
          `${installed}.ts pr acme-owner/widgets 501`,
          "main checkout",
        ],
        [
          "a core skill's bun script from the main checkout",
          `${core}.ts pr acme-owner/widgets 501`,
          "main checkout",
        ],
        [
          "an installed skill's python script by its path",
          `${installed}.py pr acme-owner/widgets 501`,
        ],
        ["a core skill's node script by its path", `${core}.mjs pr acme-owner/widgets 501`],
        [
          "a bun script in a clone with no bunfig.toml",
          `${installed}.ts pr acme-owner/widgets 501`,
          "plain clone",
        ],
        [
          "a bun script in a clone whose bunfig.toml is above its root",
          `${core}.ts pr acme-owner/widgets 501`,
          "outside clone under a bunfig",
        ],
      ]
    },
  },
]

// The forms the guard lets run: the main checkout's own bunfig.toml, a runner that reads none, and a work tree with no bunfig.toml up to its root.
export const allowed = [
  "an installed skill's bun script from the main checkout",
  "a core skill's bun script from the main checkout",
  "an installed skill's python script by its path",
  "a core skill's node script by its path",
  "a bun script in a clone with no bunfig.toml",
  "a bun script in a clone whose bunfig.toml is above its root",
]
