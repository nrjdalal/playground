import { type Group } from "./_shared"

// The made-up extension repository the harness's synced data folder guards, by its URL, which a push names from any folder.
const EXT = "https://github.com/quillco/acme-skills.git"

// The writes that stay refused once a push of branches other than the default passes; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-extension-repo-write"],
    rows: () => [
      ["a push of the default by URL", `git push ${EXT} HEAD:main`],
      ["a push of the default by its full ref", `git push ${EXT} HEAD:refs/heads/main`],
      ["a push of master", `git push ${EXT} HEAD:master`],
      ["a force-push to the default", `git push --force ${EXT} HEAD:main`],
      ["a force-push to the default by +", `git push ${EXT} +HEAD:main`],
      ["a push of HEAD with no destination", `git push ${EXT} HEAD`],
      ["a push with no refspec", `git push ${EXT}`],
      ["a tag push", `git push ${EXT} HEAD:refs/tags/v1`],
      ["a push of --tags", `git push --tags ${EXT} HEAD:feature`],
      ["a delete of a branch", `git push ${EXT} :feature`],
      ["a glob refspec", `git push ${EXT} 'refs/heads/*:refs/heads/*'`],
      ["a push by --repo", `git push --repo=${EXT} HEAD:feature`],
      ["gh pr merge", "gh pr merge 3 -R quillco/acme-skills --squash"],
      [
        "gh api PUT on a pull request's merge",
        "gh api -X PUT repos/quillco/acme-skills/pulls/3/merge",
      ],
      [
        "the GitHub MCP's merge",
        {
          input: { owner: "quillco", pullNumber: 3, repo: "acme-skills" },
          tool: "mcp__github-shared__merge_pull_request",
        },
      ],
    ],
  },
]
