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
      [
        "an inline bun program whose shell template removes a brace word matching the data folder",
        "bun -e 'await Bun.$`rmdir ~/{.play,x}ground`'",
      ],
      [
        "an inline bun program whose shell template removes a glob climbing back to the data folder",
        "bun -e 'await Bun.$`rmdir ~/D*/../.play?round`'",
      ],
      [
        "an inline bun program whose shell template removes a glob through a dot folder into the root",
        "bun -e 'await Bun.$`rmdir ~/.play*/./ext*/.no-such-folder`'",
      ],
      [
        "an inline bun program whose shell template removes a brace glob into the root",
        "bun -e 'await Bun.$`rmdir ~/.play*/{ext,x}*/.no-such-folder`'",
      ],
      [
        "an inline bun program whose shell template removes a negated class matching the data folder",
        "bun -e 'await Bun.$`rmdir ~/.p[^x]ayground`'",
      ],
      [
        "an inline bun program whose shell template removes a named class matching the data folder",
        "bun -e 'await Bun.$`rmdir ~/.p[[:alpha:]]ayground`'",
      ],
      [
        "an inline bun program whose shell template removes a class holding a star",
        "bun -e 'await Bun.$`rmdir ~/.p[*]ayground`'",
      ],
      [
        "an inline bun program whose shell template removes a glob above the home",
        "bun -e 'await Bun.$`rmdir ~/../*`'",
      ],
      [
        "an inline bun program whose shell template copies into the home",
        "bun -e 'await Bun.$`cp -R /tmp/no-such-x/. ~`'",
      ],
      [
        "an inline bun program whose shell template unpacks into the home",
        "bun -e 'await Bun.$`tar -xf /tmp/no-such-a.tar -C ~`'",
      ],
      [
        "an inline node program running a removal of a glob through execSync",
        `node -e 'require("child_process").execSync("rmdir ~/.play*")'`,
      ],
      [
        "an inline node program running a removal joined from two strings through execSync",
        `node -e 'require("child_process").execSync("rmdir " + "~/.play*")'`,
      ],
      [
        "an inline bun program spawning a removal of a glob as an argument list",
        `bun -e 'Bun.spawnSync(["rmdir", "~/.play*"])'`,
      ],
      [
        "an inline bun program whose private field reads as a shell comment ahead of a removal",
        "bun -e 'class A { #x = 1 }; await Bun.$`rmdir ~`'",
      ],
      [
        "an inline bun program whose private field reads as a shell comment ahead of a guarded playground call",
        "bun -e 'class A { #x = 1 }; await Bun.$`playground ext add a b`'",
      ],
      [
        "an inline bun program whose JavaScript comment holds a # ahead of a removal",
        "bun -e 'x /* # */; await Bun.$`rmdir ~`'",
      ],
      [
        "an inline bun program holding a tilde, on a line with a root shell",
        `bun -e 'const s = "a ~ b"'; echo ls | sudo -s`,
      ],
      [
        "an inline bun program given as a glob the shell expands into the root",
        "bun -e ~/.play*/ext*/.no-such-folder/x",
      ],
    ],
  },
  {
    folders: ["process home", "process data folder"],
    guards: ["no-extensions-write"],
    rows: () => [
      [
        "an inline bun program spawning a copy into the home's variable",
        `bun -e 'Bun.spawnSync(["cp", "-R", "/tmp/no-such-x/.", process.env.HOME])'`,
      ],
      [
        "an inline bun program printing a removal joined from two strings into a shell",
        `bun -e 'console.log("rmdir ~/.pl" + "ayground/e*")' | sh -`,
      ],
      [
        "an inline bun program printing a removal joined from two strings into xargs' shell",
        `bun -e 'console.log("rmdir ~/.pl" + "ayground/e*")' | xargs sh -c`,
      ],
      [
        "an inline bun program printing a removal through a reader into a shell",
        `bun -e 'console.log("rmdir ~/.pl" + "ayground/e*")' | cat | sh -`,
      ],
      [
        "an inline node program running a guarded playground call joined from two strings through execSync",
        `node -e 'require("child_process").execSync("playground" + " ext add a b")'`,
      ],
      [
        "an inline bun program whose shell template runs a guarded playground call by a variable command word",
        "bun -e 'const p = \"playground\"; await Bun.$`${p} ext add a b`'",
      ],
    ],
  },
]
