import { homedir } from "node:os"

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
      // a regex literal the program turns into text keeps its reading
      [
        "an inline node program reading a regex's source",
        "node -e 'const s = /(?<=a)b/.source; console.log(s)'",
      ],
      [
        "an inline node program joining a regex to a string",
        "node -e 'const s = /(?<=a)b/ + \"\"; console.log(s)'",
      ],
      [
        "an inline node program turning a regex into a string by String",
        "node -e 'const r = /(?<=a)b/; console.log(String(r))'",
      ],
      [
        "an inline node program turning a regex into a string by a template",
        "node -e 'const r = /(?<=a)b/; console.log(`${r}`)'",
      ],
      [
        "an inline node program turning a regex into a string by toString",
        "node -e 'const r = /(?<=a)b/; console.log(r.toString())'",
      ],
      [
        "an inline node program turning a regex's source into JSON",
        "node -e 'const r = /(?<=a)b/; console.log(JSON.stringify(r.source))'",
      ],
      // a regex literal naming the root or the home keeps its reading
      [
        "an inline bun program whose regex names the root's folders",
        "bun -e 'const r = /(?<=a)\\/.playground\\/extensions/; console.log(r.test(\"x\"))'",
      ],
      [
        "an inline bun program whose regex holds a tilde",
        "bun -e 'const r = /(?<=a)~/; console.log(r.test(\"x\"))'",
      ],
      // a regex literal whose output a shell may run keeps its reading
      [
        "an inline bun program holding a regex, piped into sudo's shell",
        "bun -e 'const r = /(?<=a)b/; console.log(r.test(\"ab\"))' | sudo -s",
      ],
      [
        "an inline node program holding a regex, inside a command substitution",
        'echo "$(node -e \'const r = /(?<=a)b/; console.log(r.test("ab"))\')"',
      ],
      // a division the scan could take for a regex keeps its reading
      [
        "an inline node program dividing after a postfix increment, around a guarded playground call",
        'node -e \'let a = 1; a++ / require("child_process").execSync("playground ext add a b") / 1\'',
      ],
      [
        "an inline node program dividing after a postfix decrement, around a guarded playground call",
        'node -e \'let a = 1; a-- / require("child_process").execSync("playground ext add a b") / 1\'',
      ],
      [
        "an inline node program dividing after a spaced postfix increment, around a guarded playground call",
        'node -e \'let a = 1; a ++ / require("child_process").execSync("playground ext add a b") / 1\'',
      ],
      [
        "an inline node program dividing after an element's postfix increment, around a guarded playground call",
        'node -e \'let a = [1]; a[0]++ / require("child_process").execSync("playground ext add a b") / 1\'',
      ],
      [
        "an inline node program dividing after a postfix increment, around a removal of a glob reaching the root",
        'node -e \'let a = 1; a++ / require("child_process").execSync("cd; rmdir .play*/ext*/.no-such-folder") / 1\'',
      ],
      [
        "an inline node program dividing an object literal, around a guarded playground call",
        'node -e \'x = {} / require("child_process").execSync("playground ext add a b") / 1\'',
      ],
      [
        "an inline node program dividing an object literal, around a removal of a glob reaching the root",
        'node -e \'x = {} / require("child_process").execSync("cd; rmdir .play*/ext*/.no-such-folder") / 1\'',
      ],
      [
        "an inline node program dividing after an empty block, around a guarded playground call",
        'node -e \'if (1) {} / require("child_process").execSync("playground ext add a b") / 1\'',
      ],
      [
        "an inline node program dividing a member named in, around a guarded playground call",
        'node -e \'const o = {in: 1}; o.in / require("child_process").execSync("playground ext add a b") / 1\'',
      ],
      [
        "an inline node program dividing a member named of, around a guarded playground call",
        'node -e \'const o = {of: 1}; o.of / require("child_process").execSync("playground ext add a b") / 1\'',
      ],
      [
        "an inline node program dividing an optional member named in, around a guarded playground call",
        'node -e \'const o = {in: 1}; o?.in / require("child_process").execSync("playground ext add a b") / 1\'',
      ],
      [
        "an inline node program dividing a private field named in, around a guarded playground call",
        'node -e \'class A { #in = 1; f() { return this.#in / require("child_process").execSync("playground ext add a b") / 1 } }\'',
      ],
      // an alias of the shell tag or of spawn
      [
        "an inline bun program whose shell tag, destructured from Bun under its own name, removes a path in the root",
        "bun -e 'const { $ } = Bun; await $`rmdir ~/.playground/extensions/.no-such-folder`'",
      ],
      [
        "an inline bun program spawning a removal in the root through a renamed spawnSync destructured from Bun",
        `bun -e 'const { spawnSync: s } = Bun; s(["rmdir", "${homedir()}/.playground/extensions/.no-such-folder"])'`,
      ],
      [
        "an inline bun program whose destructured shell tag removes a path in the root built from the home's variable and a template part",
        "bun -e 'const { $ } = Bun; await $`rmdir ${process.env.HOME}/.pla${\"yground\"}/extensions/.no-such-folder`'",
      ],
      [
        "an inline bun program whose destructured shell tag runs a guarded playground call",
        "bun -e 'const { $ } = Bun; await $`playground ext add a b`'",
      ],
      [
        "an inline bun program whose destructured shell tag removes a glob into the root built from a computed home variable",
        'bun -e \'const { $ } = Bun; await $`rmdir ${process.env["HO" + "ME"]}/.pla${"yground"}/ext*/.no-such-folder`\'',
      ],
      [
        "an inline bun program whose shell tag, read through a variable holding Bun, removes a glob into the root",
        "bun -e 'const x = Bun; await x.$`rmdir ~/.pla${\"yground\"}/ext*/.no-such-folder`'",
      ],
      // a computed member used as a template tag
      [
        "an inline bun program whose shell tag is a computed member of Bun, removing a path in the root",
        "bun -e 'await Bun[\"$\"]`rmdir ~/.playground/extensions/.no-such-folder`'",
      ],
      // a module named at run time
      [
        "an inline node program running a removal in the root through a renamed execSync of a module named by two joined strings",
        'node -e \'const { execSync: x } = require("chi" + "ld_process"); x("rmdir ~/.playground/extensions/.no-such-folder")\'',
      ],
      [
        "an inline node program removing a path in the root through a renamed rmdirSync of a module named by a variable",
        'node -e \'const m = "fs"; const { rmdirSync: r } = require(m); r(process.env.HOME + "/.playground/extensions/.no-such-folder")\'',
      ],
      [
        "an inline node program removing a path in the root through a module process.getBuiltinModule loads",
        `node -e 'const { rmdirSync: r } = process.getBuiltinModule("fs"); r("${homedir()}/.playground/extensions/.no-such-folder")'`,
      ],
      [
        "an inline node program running a removal in the root through execFileSync.call of a module named by two joined strings",
        `node -e 'const c = require("child" + "_process"); c.execFileSync.call(null, "rmdir", ["${homedir()}/.playground/extensions/.no-such-folder"])'`,
      ],
      [
        "an inline node program running a removal in the root through module.require of two joined strings",
        'node -e \'module.require("child_" + "process").execSync.call(null, "rmdir ~/.playground/extensions/.no-such-folder")\'',
      ],
      // a Bun file method
      [
        "an inline bun program deleting a file in the root through Bun.file",
        `bun -e 'await Bun.file("${homedir()}/.playground/extensions/.no-such-file").delete()'`,
      ],
      [
        "an inline bun program truncating a file in the root through Bun.file's writer",
        `bun -e 'Bun.file("${homedir()}/.playground/extensions/.no-such-file").writer().end()'`,
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
      [
        "an inline bun program feeding a removal into eval through a command substitution",
        `eval "$(bun -e 'console.log("rmdir ~/.pl" + "ayground/e*")')"`,
      ],
      [
        "an inline bun program feeding a removal into eval through a backtick substitution",
        'eval "`bun -e \'console.log("rmdir ~/.playground/e*")\'`"',
      ],
      [
        "an inline bun program in a subshell feeding a removal into a shell",
        `( bun -e 'console.log("rmdir ~/.playground/e*")' ) | sh -`,
      ],
      // a module named at run time
      [
        "an inline node program running a removal of a glob joined from two strings through a renamed execSync of a module named by two joined strings",
        'node -e \'const { execSync: x } = require("chi" + "ld_process"); x("rmdir ~/.pla" + "yground/ext*/.no-such-folder")\'',
      ],
      // a Bun file method
      [
        "an inline bun program deleting a file in the root through Bun.file, its path joined from the working folder and two strings",
        'bun -e \'await Bun.file(process.cwd() + "/.pla" + "yground/extensions/.no-such-file").delete()\'',
      ],
      // a division the scan could take for a regex keeps its reading
      [
        "an inline bun program dividing after a postfix increment, around a guarded playground call it spawns",
        'bun -e \'let a = 1; a++ / Bun.spawnSync(["playground", "ext", "add", "a", "b"]) / 1\'',
      ],
      // dynamic code
      [
        "an inline node program reaching process through a bare Function call",
        "node -e 'Function(\"return process\")().mainModule'",
      ],
      [
        "an inline node program running code through an indirect eval",
        "node -e '(0, eval)(\"1 + 1\")'",
      ],
    ],
  },
]
