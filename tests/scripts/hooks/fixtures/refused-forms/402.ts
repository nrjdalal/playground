import { type Group } from "./_shared"

const fill = (head: string, unit: string, tail: string) =>
  head + unit.repeat(Math.floor((130_000 - head.length - tail.length) / unit.length)) + tail

// A printf output of about 1.1 MB from a 50 KB command, which a shell reads whole.
const PAD = "x".repeat(40)
const COLONS = ": ".repeat(25_000)

// A push to the made-up extension repo the runner's synced data folder names.
const PUSH = "git push https://github.com/quillco/acme-skills main"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["home"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["rm of a glob from the home", "rm -rf .playground/ext*"],
      ["rm of a glob in the home that matches the data folder", "rm -rf .p*"],
      ["rm of a glob held in a quoted variable", 'X=".playground/ext*"; rm -rf $X'],
      ["rm of a brace that makes the root's name", "rm -rf .playground/{x,extensions}"],
      ["rm of a glob that matches a link to the root", "rm -rf st*/hooks"],
      ["rm of a bare glob that matches a link to the root", "rm -rf s*/"],
      ["a redirect through a glob that matches a link to the root", "echo x > s*/policy.json"],
      ["cp through a glob that matches a link to the root", "cp /etc/hosts s*/policy.json"],
      ["rm of a ksh glob in the home", "setopt kshglob\nrm -rf +(.playground)"],
      [
        "awk printing into the root by its path as seen from the home",
        `awk '{print > ".playground/extensions/policy.json"}' /dev/null`,
      ],
      ["rm of a glob with a .. after it", "rm -rf w*/../.playground/extensions"],
      ["rm of an extglob in the data folder", "rm -rf .playground/@(extensions)"],
      ["rm of a negated extglob in the data folder", "rm -rf .playground/!(handoffs)"],
      ["perl -e unlinking a glob of the root", `perl -e 'unlink glob ".p*/extensions/*"'`],
      [
        "perl -M…-e removing a glob of the root",
        `perl -MFile::Path=rmtree -e 'rmtree(glob(".p*/ext*"))'`,
      ],
      [
        "node -e removing the root by a built name",
        `node -e 'require("fs").rmSync(".playground/ext"+"ensions",{recursive:true})'`,
      ],
      [
        "node -e writing into the root by a built name",
        `node -e 'require("fs").writeFileSync(".playground/ext"+"ensions/policy.json","x")'`,
      ],
      [
        "perl by a versioned name unlinking a glob of the root",
        `perl5.34 -e 'unlink glob ".p*/extensions/*"'`,
      ],
      [
        "nodejs -e removing the root by a built name",
        `nodejs -e 'require("fs").rmSync(".playground/ext"+"ensions",{recursive:true})'`,
      ],
      [
        "npx node -e removing the root by a built name",
        `npx node -e 'require("fs").rmSync(".playground/ext"+"ensions",{recursive:true})'`,
      ],
      [
        "bunx node -e removing the root by a built name",
        `bunx node -e 'require("fs").rmSync(".playground/ext"+"ensions",{recursive:true})'`,
      ],
      [
        "tsx -e removing the root by a built name",
        `tsx -e 'require("fs").rmSync(".playground/ext"+"ensions",{recursive:true})'`,
      ],
      [
        "awk's system() removing a glob of the data folder",
        `awk 'BEGIN{system("rm\\t-rf\\t.p*")}'`,
      ],
      [
        "a shell reading date, then a printf output past 1 MB that removes the root",
        `bash <(date; printf '%s\\n#${PAD}\\n' ${COLONS} 'rm -rf .playground/extensions')`,
      ],
      [
        "a shell reading curl, then a printf output past 1 MB that removes the root",
        `bash <(curl -s https://example.com; printf '%s\\n#${PAD}\\n' ${COLONS} 'rm ~/.playground/extensions')`,
        "tmp",
      ],
      [
        "a group's date, then a printf output past 1 MB that removes the root, piped to a shell",
        `(date; printf '%s\\n#${PAD}\\n' ${COLONS} 'rm -rf .playground/extensions') | bash`,
      ],
      [
        "source reading date, then a printf output past 1 MB that removes the root",
        `source <(true; date; printf '%s\\n#${PAD}\\n' ${COLONS} 'rm -rf .playground/extensions')`,
      ],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-extension-repo-write"],
    rows: () => [
      [
        "a shell reading date, then a printf output past 1 MB that pushes to an extension repo",
        `bash <(date; printf '%s\\n#${PAD}\\n' ${COLONS} '${PUSH}')`,
      ],
      [
        "a group's date, then a printf output past 1 MB that pushes to an extension repo, piped to a shell",
        `(date; printf '%s\\n#${PAD}\\n' ${COLONS} '${PUSH}') | bash`,
      ],
    ],
  },
  {
    folders: ["tmp"],
    guards: ["no-extensions-write"],
    rows: ({ HOME }) => [
      [
        "rm through a missing folder, .., then a link to the root",
        `mkdir ${HOME}/m && rm -rf ${HOME}/m/../store/`,
      ],
      ["rm of a link to the root through a missing folder and ..", `rm -rf ${HOME}/m/../store`],
      [
        "cp through a missing folder, .., then a link to the root",
        `mkdir -p ${HOME}/m && cp /etc/hosts ${HOME}/m/../store`,
      ],
      [
        "mv through a missing folder, .., then a link to the root",
        `mkdir -p ${HOME}/m && mv /tmp/x ${HOME}/m/../store`,
      ],
      [
        "rm through a missing folder, .., then a link to the data folder",
        `mkdir -p ${HOME}/m && rm -rf ${HOME}/m/../pg/`,
      ],
      [
        "a variable through a missing folder, .., then a link to the root",
        `V=${HOME}/m/../store/; mkdir ${HOME}/m; rm -rf $V`,
      ],
      [
        "the CLI by a link through a missing folder and ..",
        `${HOME}/m/../pc ext put login list x /tmp/l.json --reason y`,
      ],
      [
        "bun on the CLI by a link through a missing folder and ..",
        `bun ${HOME}/m/../pc ext put login list x /tmp/l.json --reason y`,
      ],
      [
        "rm through two missing folders, .., .., then a link to the root",
        `rm -rf ${HOME}/m/n/../../store/`,
      ],
      [
        "git -C through a missing folder, .., then a link to the root",
        `git -C ${HOME}/m/../store reset --hard`,
      ],
    ],
  },
  {
    folders: ["tmp"],
    guards: ["no-extensions-write"],
    rows: ({ WORDS }) => [
      [
        "xargs -I over a large stdin at the command cap",
        fill(`cat ${WORDS} | xargs -I@ git -c alias.x="!`, "@ ", '" x'),
      ],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-stash"],
    rows: () => [
      [
        "a stash at the end of a printf output past 1 MB that a shell reads",
        `bash <(printf '#${"x".repeat(1_100)}\\n%s\\n' ${"a ".repeat(1_000)} 'git stash')`,
      ],
    ],
  },
]
