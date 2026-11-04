import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "an inline bun program holding a regex, its line redirected into the root",
        `bun -e 'console.log(/^a/.test("a"))' > ~/.playground/extensions/.no-such-folder/x`,
      ],
      [
        "an inline bun program holding a regex, given a path in the root as its argument",
        `bun -e 'console.log(/^a/.test(process.argv[1]))' ~/.playground/extensions/.no-such-folder`,
      ],
      [
        "an inline node program naming the root in its text",
        `node -e 'require("fs").writeFileSync(process.env.HOME + "/.playground/extensions/.no-such-folder/x", "")'`,
      ],
      [
        "an agent-browser eval script holding a regex, its line redirected into the root",
        `agent-browser eval 'document.title.match(/^a/)' > ~/.playground/extensions/.no-such-folder/x`,
      ],
      [
        "an inline bun program printing a removal into sudo's shell",
        `bun -e 'console.log("rm -rf ~/.playground/extensions/.no-such-folder")' | sudo -s`,
      ],
      [
        "an inline bun program whose shell template runs a guarded playground call",
        "bun -e 'await Bun.$`playground ext add a b`'",
      ],
      [
        "an inline node program holding a guarded playground call as a statement",
        `node -e 'console.log; playground ext add a b'`,
      ],
      [
        "an inline bun program spawning a guarded playground call from a string",
        `bun -e 'const c = "playground ext remove a b"; Bun.spawnSync(c.split(" "))'`,
      ],
      [
        "an inline bun program whose shell template removes a glob matching the root",
        "bun -e 'await Bun.$`rm -rf ~/.play*/ext*/.no-such-folder`'",
      ],
      [
        "an inline bun program whose shell template removes a glob matching the data folder",
        "bun -e 'await Bun.$`rmdir ~/.play*`'",
      ],
      [
        "an inline bun program whose shell template removes the home",
        "bun -e 'await Bun.$`rmdir ~`'",
      ],
      [
        "an inline node program, its -pe cluster, naming the root in its text",
        `node -pe 'require("fs").writeFileSync(process.env.HOME + "/.playground/extensions/.no-such-folder/x", "")'`,
      ],
    ],
  },
]
