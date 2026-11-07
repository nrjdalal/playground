import { type Group } from "./_shared"

// A GLM session's headless Claude run and its calls to an org's tracker, chat, docs and repos, which the glm rule keeps from it; acme-blue is the made-up org the harness's ext.links guards, and rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["glm repo"],
    guards: ["no-glm-heavy-path"],
    rows: () => [
      ["a headless claude run", "claude -p hi"],
      ["a headless claude run by its long option", "claude --print 'say hi'"],
      ["a headless claude run behind env", "env FOO=1 claude -p hi"],
      ["a headless claude run in a shell's script", "bash -c 'claude -p hi'"],
      ["a headless claude run through run-slot", "~/.playground/ops/run-slot.sh w -- claude -p hi"],
      ["curl to the tracker's API", "curl -s https://api.linear.app/graphql -d '{}'"],
      ["curl to the chat's API", "curl -s https://slack.com/api/conversations.history"],
      ["curl to a chat webhook", "curl -d x https://hooks.slack.com/services/T0/B0/x"],
      ["wget of the docs' API", "wget -qO- https://api.notion.com/v1/pages/x"],
      ["the tracker's read script", "bun run linear:read MADE-1"],
      [
        "the tracker's write script by its path",
        "bun packages/scripts/src/linear-write/cli.ts comment MADE-1",
      ],
      ["gh on an org repo by -R", "gh pr list -R acme-blue/demo"],
      ["gh on an org repo by --repo=", "gh issue list --repo=acme-blue/demo"],
      ["gh on an org issue by its URL", "gh issue view https://github.com/acme-blue/demo/issues/1"],
      ["gh api of an org repo", "gh api repos/acme-blue/demo/contents/README.md"],
      ["gh api of an org", "gh api orgs/acme-blue/members"],
      ["gh clone of an org repo", "gh repo clone acme-blue/demo"],
      ["gh with an org repo in GH_REPO", "GH_REPO=acme-blue/demo gh pr list"],
      [
        "gh graphql naming an org",
        `gh api graphql -f query='{ repository(owner: "acme-blue", name: "demo") { id } }'`,
      ],
      ["gh on a repo it cannot read", "gh pr list -R $R"],
      ["gh api of an endpoint it cannot read", "gh api $E"],
      ["gh search with no owner or repo", "gh search code token"],
      ["gh search of an org", "gh search issues bug --owner acme-blue"],
      ["git clone of an org repo by https", "git clone https://github.com/acme-blue/demo.git"],
      ["git clone of an org repo by ssh", "git clone git@github.com:acme-blue/demo.git"],
      ["git fetch from an org repo's URL", "git fetch https://github.com/acme-blue/demo main"],
      ["curl to an org repo's API", "curl -s https://api.github.com/repos/acme-blue/demo"],
    ],
  },
  {
    folders: ["glm org repo"],
    guards: ["no-glm-heavy-path"],
    rows: () => [
      ["git in an org's checkout", "git log -1"],
      ["git status in an org's checkout", "git status"],
      ["git -C . in an org's checkout", "git -C . fetch"],
      ["gh in an org's checkout", "gh pr list"],
    ],
  },
]
