import { type Group } from "./_shared"

// The forms the review of this file's source found refused, with #603's; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "rm of a relative path after a cd to a variable",
        `cd "$D"; rm -rf extensions/.no-such-folder`,
      ],
      [
        "rm of a relative path after a chained cd to a variable",
        `cd "$D" && rm -rf extensions/.no-such-folder`,
      ],
      [
        "rm of a relative path after a cd to an unquoted variable",
        "cd $D; rm -rf extensions/.no-such-folder",
      ],
      [
        "rm of a relative path after a cd to a substitution",
        `cd "$(cat p)"; rm -rf extensions/.no-such-folder`,
      ],
      [
        "rm of a relative path after a pushd to a variable",
        `pushd "$D"; rm -rf extensions/.no-such-folder`,
      ],
      ["mv of a relative path after a cd to a variable", `cd "$D"; mv policy.json /tmp/p.json`],
      ["git with a config taken from the environment", "git --config-env=core.pager=P log"],
      [
        "git with a config taken from the environment as its own word",
        "git --config-env core.pager=P log",
      ],
      ["git with a pager variable from a variable", `GIT_PAGER="$P" git log`],
      ["git with an editor variable from a variable", `GIT_EDITOR="$E" git commit`],
      ["git with an exported pager variable from a variable", `export GIT_PAGER="$P"; git log`],
      [
        "git with a counted config value from a variable",
        `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0="$P" git log`,
      ],
      ["git with config parameters from a variable", `GIT_CONFIG_PARAMETERS="$C" git log`],
      ["git with a global config file from a variable", `GIT_CONFIG_GLOBAL="$G" git log`],
      ["cp to a variable", `cp x "$D"`],
      ["cp to a path under a variable", `cp x "$D/x"`],
      ["cp into a target folder from a variable", `cp -t "$D" x`],
      ["cp into a long target folder from a variable", `cp --target-directory="$D" x`],
      ["cp to a substitution", `cp x "$(cat p)"`],
      ["ln to a path under a variable", `ln -s x "$D/x"`],
      ["install to a path under a variable", `install x "$D/x"`],
      ["tee to a path under a variable", `tee "$D/x" < y`],
      ["tee appending to a path under a variable", `echo x | tee -a "$D/x"`],
      ["dd to a path under a variable", `dd if=x of="$D/x"`],
      ["touch of a path under a variable", `touch "$D/x"`],
      ["mkdir of a path under a variable", `mkdir -p "$D/x"`],
    ],
  },
  {
    folders: ["data folder"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["a redirect to a relative file after a cd to a variable", `cd "$X"; echo x > policy.json`],
      ["touch of a relative file after a cd to a variable", `cd "$X"; touch policy.json`],
      [
        "a redirect into the root after a cd that may not run",
        "true || cd /tmp; echo x > extensions/policy.json",
      ],
    ],
  },
]
