import { type Group } from "./_shared"

// The inline-code writes #3092's review found that canary refuses: a write program named by its path, and a write call with a comment or a division before its arguments; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home"],
    guards: ["no-roster-write"],
    rows: () => [
      [
        "a python os.system call of rm named by its path onto the roster",
        `python3 -c "import os; os.system('/bin/rm ~/.playground/roster.json')"`,
      ],
      [
        "a python subprocess.run of rm named by its path onto the roster",
        `python3 -c "import subprocess; subprocess.run(['/bin/rm', '$HOME/.playground/roster.json'])"`,
      ],
      [
        "a node execSync of rm named by its path onto the roster",
        `node -e "require('child_process').execSync('/bin/rm ~/.playground/roster.json')"`,
      ],
      [
        "an awk system call of rm named by its path onto the roster",
        `awk 'BEGIN{system("/bin/rm ~/.playground/roster.json")}'`,
      ],
      [
        "a python os.system call of truncate named by its path onto the roster",
        `python3 -c "import os; os.system('/usr/bin/truncate -s0 ~/.playground/roster.json')"`,
      ],
      [
        "a perl unlink of the roster after a division",
        `perl -e '$x=1/unlink("$ENV{HOME}/.playground/roster.json")'`,
      ],
      [
        "a node writeFileSync onto the roster after a comment",
        `node -e "require('fs')/**/.writeFileSync('$HOME/.playground/roster.json', '{}')"`,
      ],
      [
        "a Bun.write onto the roster after a comment",
        `bun -e "Bun/**/.write('$HOME/.playground/roster.json', '{}')"`,
      ],
      [
        "a python os.unlink of the roster after a division",
        `python3 -c "import os; (1)/os.unlink('$HOME/.playground/roster.json')"`,
      ],
      [
        "a node writeFileSync onto the roster with a comment before its arguments",
        `node -e "require('fs').writeFileSync/**/('$HOME/.playground/roster.json', '{}')"`,
      ],
      [
        "a node writeFileSync from a bound fs onto the roster with a comment before its arguments",
        `node -e "const fs=require('fs');fs.writeFileSync/**/('$HOME/.playground/roster.json','{}')"`,
      ],
      [
        "a node rmSync of the roster with a comment before its arguments",
        `node -e "require('fs').rmSync/**/('$HOME/.playground/roster.json')"`,
      ],
      [
        "a perl unlink of the roster with a comment-shaped match before its arguments",
        `perl -e 'unlink/**/("$ENV{HOME}/.playground/roster.json")'`,
      ],
      [
        "a perl unlink of the roster with a division before its arguments",
        `perl -e 'unlink/1/("$ENV{HOME}/.playground/roster.json")'`,
      ],
      [
        "a Bun.write onto the roster with a comment before its arguments",
        `bun -e "await Bun.write/**/('$HOME/.playground/roster.json', '{}')"`,
      ],
    ],
  },
]
