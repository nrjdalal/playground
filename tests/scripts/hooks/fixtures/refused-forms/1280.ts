import { type Group } from "./_shared"

// A reviewer in read mode writing where a later call runs it: an export of the extensions into a folder the hook trusts as an installed skill's or into any folder, a copy whose target GNU reads from a target-folder or suffix option, and a copy into the session's own folders that makes a repository git then reads or carries a link a later copy writes through.
const NAME = "p7w3zc-reviewer"

export const groups: Group[] = [
  {
    folders: ["main checkout", "outside clone", "scratch folder"],
    guards: ["no-outside-pr-code"],
    rows: ({ DATA }) => {
      const pad = `${DATA}/scratchpad/${NAME}`
      const skills = `${DATA}/orgs/zz/skills`
      return [
        ["an export into the installed skills", `playground ext export ${skills}/`],
        [
          "an export into the installed skills, then its script",
          `playground ext export ${skills}/ && sh ${skills}/acme/scripts/run/run.sh`,
        ],
        ["an export into a folder outside its own", "playground ext export /tmp/anywhere"],
        [
          "a copy whose GNU target-folder option is shortened",
          `cp --target=${DATA}/ops evil.sh ${pad}/a`,
        ],
        [
          "a copy whose GNU target-folder option is spelled short",
          `cp --target-dir=${DATA}/ops evil.sh ${pad}/a`,
        ],
        [
          "a copy whose GNU suffix value sits last",
          `cp evil.sh ${DATA}/ops/run-slot.sh -S ${pad}/a`,
        ],
        [
          "a copy that makes a repository git then reads",
          `cp -R emb ${pad}/x/.git && git -C ${pad}/x status`,
        ],
        [
          "a copy that carries a link a second copy writes through",
          `cp -R linkdir ${pad}/y && cp evil.sh ${pad}/y/l/run-slot.sh`,
        ],
      ]
    },
  },
]
