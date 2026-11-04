import { type Group } from "./_shared"

// A guarded org's repository by its URL, which a push names from any folder.
const ORG = "https://github.com/acme-blue/app.git"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["data folder", "home"],
    guards: ["no-stash"],
    rows: ({ WORK }) => [
      ["git --attr-source before a stash", "git --attr-source HEAD stash pop"],
      ["git -c before a stash", "git -c k=v stash pop"],
      ["git -C before a stash", `git -C ${WORK} stash pop`],
      ["git -c with a subcommand for its value", "git -c log stash pop"],
      ["git --namespace with a subcommand for its value", "git --namespace log stash pop"],
      ["git -C with a subcommand for its value", "git -C log stash pop"],
      ["git --work-tree with a subcommand for its value", "git --work-tree log stash pop"],
      ["git --attr-source with a subcommand for its value", "git --attr-source push stash pop"],
    ],
  },
  {
    folders: ["data folder", "home"],
    guards: ["no-playground-leak"],
    rows: () => [
      [
        "git --attr-source before a push",
        `git --attr-source HEAD push ${ORG} HEAD:worker-greed/fix`,
      ],
      ["git -c before a push", `git -c k=v push ${ORG} HEAD:worker-greed/fix`],
      ["git -C before a push", `git -C /tmp push ${ORG} HEAD:worker-greed/fix`],
      [
        "git --config-env before a push",
        `git --config-env core.pager=HOME push ${ORG} HEAD:worker-greed/fix`,
      ],
      ["a literal -c alias for push", `git -c alias.p=push p ${ORG} HEAD:worker-greed/fix`],
      [
        "a literal -c alias for push after --attr-source",
        `git --attr-source HEAD -c alias.p=push p ${ORG} HEAD:worker-greed/fix`,
      ],
      ["a ! alias", `git -c 'alias.p=!git push' p ${ORG} HEAD:worker-greed/fix`],
      [
        "an alias that names another alias",
        `git -c alias.q=push -c alias.p=q p ${ORG} HEAD:worker-greed/fix`,
      ],
      ["an alias the hook cannot read", `git -c "alias.p=$X" p ${ORG} HEAD:worker-greed/fix`],
      ["an alias in another case", `git -c alias.P=push p ${ORG} HEAD:worker-greed/fix`],
      [
        "an alias --config-env sets",
        `git --config-env alias.p=HOME p ${ORG} HEAD:worker-greed/fix`,
      ],
      [
        "a -c word the hook cannot read before an alias",
        `git -c "$X" p ${ORG} HEAD:worker-greed/fix`,
      ],
      [
        "an alias whose name the hook cannot read",
        `x=p; git -c alias.$x=push p ${ORG} HEAD:worker-greed/fix`,
      ],
      [
        "a subcommand the hook cannot read after an alias",
        `git -c alias.p=push $Y ${ORG} HEAD:worker-greed/fix`,
      ],
      [
        "git --config-env with a subcommand for its value",
        `git --config-env log push ${ORG} HEAD:worker-greed/fix`,
      ],
      [
        "git --namespace with a subcommand for its value",
        `git --namespace log push ${ORG} HEAD:worker-greed/fix`,
      ],
    ],
  },
  {
    folders: ["glm repo"],
    guards: ["no-glm-heavy-path"],
    rows: () => [
      ["git --attr-source before a commit of a heavy path", "git --attr-source HEAD commit -m x"],
      [
        "git --exec-path before a commit of a heavy path",
        "git --exec-path=/usr/libexec commit -m x",
      ],
      ["git --namespace with a subcommand for its value", "git --namespace log commit -m x"],
      [
        "git --attr-source with a subcommand for its value before a commit of a heavy path",
        "git --attr-source log commit -m x",
      ],
      [
        "git --attr-source with a subcommand for its value before a read in a repo with a heavy path staged",
        "git --attr-source commit log -1",
      ],
    ],
  },
  {
    folders: ["main checkout"],
    guards: ["no-main-checkout"],
    rows: () => [
      [
        "git --attr-source before a reset in the main checkout",
        "git --attr-source HEAD reset --hard",
      ],
      [
        "git --attr-source with a subcommand for its value before a checkout in the main checkout",
        "git --attr-source log checkout x",
      ],
    ],
  },
  {
    folders: ["extensions root"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "git --attr-source with a subcommand for its value before a commit in the extensions root",
        "git --attr-source log commit -m x",
      ],
      [
        "git --attr-source with a subcommand for its value before a push from the extensions root",
        "git --attr-source log push origin HEAD:main",
      ],
      [
        "git --attr-source with a subcommand for its value before a config write in the extensions root",
        "git --attr-source log config core.hooksPath x",
      ],
    ],
  },
  {
    folders: ["data folder", "home"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => [
      [
        "git --attr-source with a subcommand for its value before -C into the extensions root and a commit",
        `git --attr-source log -C ${ROOT} commit -m x`,
      ],
    ],
  },
  {
    folders: ["checkout"],
    guards: ["no-extension-repo-write"],
    rows: () => [
      [
        "a repoint behind --attr-source taking --config-env as its value, then a push",
        "git --attr-source --config-env remote set-url origin https://github.com/quillco/acme-skills.git && git push origin main",
      ],
      [
        "a push-url repoint behind --attr-source taking --config-env as its value, then a push",
        "git --attr-source --config-env remote set-url --push origin https://github.com/quillco/acme-skills.git && git push origin main",
      ],
      [
        "a pushurl config behind --attr-source taking --config-env as its value, then a push",
        "git --attr-source --config-env config remote.origin.pushurl https://github.com/quillco/acme-skills.git && git push origin main",
      ],
      [
        "a repoint behind --namespace taking --config-env as its value, then a push",
        "git --namespace --config-env remote set-url origin https://github.com/quillco/acme-skills.git && git push origin main",
      ],
      [
        "a repoint behind --attr-source taking -c as its value, then a push",
        "git --attr-source -c remote set-url origin https://github.com/quillco/acme-skills.git && git push origin main",
      ],
      [
        "a repoint behind --config-env, then a push",
        "git --config-env core.x=HOME remote set-url origin https://github.com/quillco/acme-skills.git && git push origin main",
      ],
      [
        "a pushurl config behind --config-env, then a push",
        "git --config-env core.x=HOME config remote.origin.pushurl https://github.com/quillco/acme-skills.git && git push origin main",
      ],
      [
        "a clone behind --config-env, then a push",
        "git --config-env core.x=HOME clone https://github.com/quillco/acme-skills.git && git push origin main",
      ],
      [
        "an init behind --config-env, then a push",
        "git --config-env core.x=HOME init && git push origin main",
      ],
    ],
  },
]

export const allowed: string[] = [
  "git --attr-source with a subcommand for its value before a read in a repo with a heavy path staged",
]
