import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a removal in an extension's jq filter",
        `gh my-ext --jq '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in a jq filter under gh extension exec",
        `gh extension exec x -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in a shell alias gh sets",
        "gh alias set --shell v 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a removal in a jq filter of an alias called by name",
        `gh v -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in a jq filter with GH_PAGER set",
        `GH_PAGER=less gh pr view 1 -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in a jq filter with PAGER set",
        `PAGER=less gh run view 1 --jq '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in a jq filter with GH_EDITOR set",
        `GH_EDITOR=vi gh issue view 1 --jq '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in a jq filter with EDITOR exported",
        `export EDITOR=vi; gh api x --jq '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in gh config's pager",
        "gh config set pager 'rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a removal in a jq filter of gh repo clone",
        `gh repo clone o/r --jq '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in a jq filter of gh pr checkout",
        `gh pr checkout 1 --jq '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in a jq filter of gh run download",
        `gh run download 1 --jq '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in a jq filter of gh release download",
        `gh release download v1 --jq '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in a jq filter of gh codespace",
        `gh codespace ssh --jq '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a gh pr view template's printed removal piped to a shell",
        `gh pr view 1 --template '"rm -rf ~/.playground/extensions/.no-such-folder"' | sh`,
      ],
      [
        "a removal in gh api's field",
        "gh api x -q '.a' -f q='rm -rf ~/.playground/extensions/.no-such-folder'",
      ],
      [
        "a removal in the jq filter of gh api with -X",
        `gh api x -X POST -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in the jq filter of gh api with -X attached",
        `gh api x -XPOST -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in the jq filter of gh api with --method=",
        `gh api x --method=PATCH -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in the jq filter of gh api with -F",
        `gh api x -F k=v -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in the jq filter of gh api with --field",
        `gh api x --field k=v -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in the jq filter of gh api with -f",
        `gh api x -f k=v -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in the jq filter of gh api with --raw-field",
        `gh api x --raw-field k=v -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in the jq filter of gh api with --input",
        `gh api x --input f.json -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a removal in the jq filter of gh api with --cache",
        `gh api x --cache 1h -q '"rm -rf ~/.playground/extensions/.no-such-folder"'`,
      ],
      [
        "a jq filter's printed removal piped to a shell",
        `gh api x -q '"rm -rf ~/.playground/extensions/.no-such-folder"' | sh`,
      ],
      [
        "a jq filter's printed removal piped to sudo's shell",
        `gh api x -q '"rm -rf ~/.playground/extensions/.no-such-folder"' | sudo -s`,
      ],
      [
        "a jq filter's printed removal written to a script, then run",
        `gh api x -q '"rm -rf ~/.playground/extensions/.no-such-folder"' > s.sh; sh s.sh`,
      ],
      [
        "a jq filter's printed removal run by eval",
        `eval "$(gh api x -q '"rm -rf ~/.playground/extensions/.no-such-folder"')"`,
      ],
      [
        "a jq filter's printed removal run by xargs",
        `gh api x -q '"rm -rf ~/.playground/extensions/.no-such-folder"' | xargs -I{} sh -c '{}'`,
      ],
      [
        "a jq filter's printed removal run by a read loop",
        `gh api x -q '"rm -rf ~/.playground/extensions/.no-such-folder"' | while read l; do $l; done`,
      ],
      [
        "a list's jq filter printing a removal piped to a shell",
        `gh pr list --json number -q '"rm -rf ~/.playground/extensions/.no-such-folder"' | sh`,
      ],
      [
        "a jq filter, then a removal",
        "gh api x --jq '.[]'; rm -rf ~/.playground/extensions/.no-such-folder",
      ],
    ],
  },
  {
    folders: ["checkout", "data folder", "home"],
    guards: ["no-extensions-write"],
    rows: ({ ROOT }) => [
      ["a jq filter's output redirected into the root", `gh api x --jq '.[]' > ${ROOT}/x`],
      ["a template's output teed into the root", `gh pr view 1 -t '{{.a}}' | tee ${ROOT}/x`],
      ["gh api with a jq filter and an input in the root", `gh api x --jq '.[]' --input ${ROOT}/x`],
      ["a jq filter naming the root", `gh api x --jq '"${ROOT}/x"'`],
      ["gh release download into the root", `gh release download v1 --output ${ROOT}/x`],
      ["gh run download into the root", `gh run download 1 -D ${ROOT}`],
    ],
  },
  {
    folders: ["data folder", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["a jq filter's unquoted glob in the home", "gh api x --jq .[]"],
      ["a template's unquoted glob in the home", "gh pr view 1 -t .pl*"],
    ],
  },
  {
    folders: ["data folder", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "a spaced jq filter in the home on gh repo clone, which is no listed read",
        `gh repo clone o/r -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh pr checkout, which is no listed read",
        `gh pr checkout 1 -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh extension exec, which is no listed read",
        `gh extension exec x -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on an extension, which is no listed read",
        `gh my-ext -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on an alias, which is no listed read",
        `gh v -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on GH_PAGER set in the call",
        `GH_PAGER=less gh pr view 1 -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on GH_EDITOR set in the call",
        `GH_EDITOR=vi gh issue view 1 -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on PAGER set in the call",
        `PAGER=less gh run view 1 -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on GH_PAGER set on the line",
        `GH_PAGER=less; gh pr view 1 -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on EDITOR exported on the line",
        `export EDITOR=vi; gh api x -q '.a+" \\(.b)/x"'`,
      ],
      ["a spaced jq filter in the home on gh api with -X", `gh api x -X POST -q '.a+" \\(.b)/x"'`],
      [
        "a spaced jq filter in the home on gh api with -X attached",
        `gh api x -XPOST -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh api with --method=",
        `gh api x --method=PATCH -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh api with --method",
        `gh api x --method PATCH -q '.a+" \\(.b)/x"'`,
      ],
      ["a spaced jq filter in the home on gh api with -F", `gh api x -F a=b -q '.a+" \\(.b)/x"'`],
      ["a spaced jq filter in the home on gh api with -f", `gh api x -f a=b -q '.a+" \\(.b)/x"'`],
      [
        "a spaced jq filter in the home on gh api with --field",
        `gh api x --field a=b -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh api with --raw-field",
        `gh api x --raw-field a=b -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh api with --input",
        `gh api x --input f.json -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh api with --cache",
        `gh api x --cache 1h -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh api with -X in a cluster",
        `gh api x -iX POST -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh api with -f in a cluster",
        `gh api x -if a=b -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh api with -F in a cluster",
        `gh api x -iF a=b -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh pr view with --web",
        `gh pr view 1 --web -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh pr view with -w",
        `gh pr view 1 -w -q '.a+" \\(.b)/x"'`,
      ],
      [
        "a spaced jq filter in the home on gh issue view with -w in a cluster",
        `gh issue view 1 -cw -q '.a+" \\(.b)/x"'`,
      ],
    ],
  },
]
