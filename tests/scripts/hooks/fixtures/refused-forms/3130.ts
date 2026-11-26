import { type Group } from "./_shared"

// The forms #3130 names: the data folder held in a shell variable, an sh -c script or inline code run from the data folder, write calls outside the guard's write words, and recursive writers on the folder; the names file is never made, and rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    // from a folder that holds no roster, so only the call's own words reach toward it
    folders: ["process tmp"],
    guards: ["no-roster-write"],
    rows: () => [
      [
        "the data folder in a variable, listed into an xargs -I string that removes each name in it",
        "D=~/.playground; ls $D | xargs -I{} rm $D/{}",
      ],
      [
        "the data folder listed into an xargs -I string that removes each name in it through a variable",
        "D=~/.playground; ls ~/.playground | xargs -I{} rm $D/{}",
      ],
      [
        "an exported variable holding the data folder, a names file into an xargs -I string that removes each name in it",
        'export D=~/.playground; cat /tmp/no-such-names.txt | xargs -I{} rm "$D/{}"',
      ],
      ["the data folder in a variable, an unread name in it removed", "D=~/.playground; rm $D/$f"],
      [
        "a names file into an xargs sh -c script that cds into the data folder and removes its words",
        `cat /tmp/no-such-names.txt | xargs sh -c 'cd ~/.playground && rm "$@"' _`,
      ],
      [
        "a names file into an xargs -I sh -c script that cds into the data folder and removes each name",
        "cat /tmp/no-such-names.txt | xargs -I{} sh -c 'cd ~/.playground && rm {}'",
      ],
      [
        "a names file into an xargs -I sh -c script that cds into the data folder and removes each quoted name",
        `cat /tmp/no-such-names.txt | xargs -I{} sh -c 'cd ~/.playground; rm -- "{}"'`,
      ],
      [
        "python3 run from the data folder, its code removing roster.json",
        `cd ~/.playground && python3 -c "import os; os.remove('roster.json')"`,
      ],
      [
        "node run from the data folder, its code unlinking roster.json",
        `cd ~/.playground && node -e "require('fs').unlinkSync('roster.json')"`,
      ],
      [
        "python3 code replacing the roster with another file",
        `python3 -c "import os; os.replace('/tmp/x', '$HOME/.playground/roster.json')"`,
      ],
      [
        "python3 code copying a file over the roster",
        `python3 -c "import shutil; shutil.copy('/tmp/x', '$HOME/.playground/roster.json')"`,
      ],
      [
        "node code copying a file over the roster",
        `node -e "require('fs').copyFileSync('/tmp/x', '$HOME/.playground/roster.json')"`,
      ],
      [
        "node code appending to the roster",
        `node -e "require('fs').appendFileSync('$HOME/.playground/roster.json', 'x')"`,
      ],
      [
        "python3 code changing the roster's mode",
        `python3 -c "import os; os.chmod('$HOME/.playground/roster.json', 0)"`,
      ],
      [
        "python3 code that changes into the data folder and replaces roster.json with another file",
        `python3 -c "import os; os.chdir('$HOME/.playground'); os.replace('/tmp/x', 'roster.json')"`,
      ],
      ["chmod -R changing the mode of everything in the data folder", "chmod -R 000 ~/.playground"],
      ["chown -R changing the owner of everything in the data folder", "chown -R x ~/.playground"],
      ["gzip -r compressing everything in the data folder in its place", "gzip -r ~/.playground"],
      [
        "chflags -R setting the immutable flag on everything in the data folder",
        "chflags -R uchg ~/.playground",
      ],
      [
        "zstd -r compressing everything in the data folder and removing each original",
        "zstd -r --rm ~/.playground",
      ],
      [
        "the data folder in a variable, a redirect onto an unread name in it",
        "D=~/.playground; echo x > $D/$f",
      ],
      [
        "the data folder in a variable, an append onto an unread quoted name in it",
        'D=~/.playground; echo x >> "$D/$f"',
      ],
      [
        "the data folder in a braced variable, a redirect onto an unread name in it",
        "D=~/.playground; echo x > ${D}/$f",
      ],
      [
        "the data folder in a variable copied to another, an unread name in it removed",
        "D=~/.playground; E=$D; rm $E/$f",
      ],
      [
        "python3 run from the data folder, its code removing ./roster.json",
        `cd ~/.playground && python3 -c "import os; os.remove('./roster.json')"`,
      ],
      [
        "node run from the data folder, its code writing ./roster.json",
        `cd ~/.playground && node -e "require('fs').writeFileSync('./roster.json', '{}')"`,
      ],
      [
        "python3 code copying a file onto the roster held in a variable",
        `python3 -c "import shutil; p='$HOME/.playground/roster.json'; shutil.copy('/tmp/x', p)"`,
      ],
      [
        "node code copying a file onto the roster built by a path join",
        `node -e "require('fs').copyFileSync('/tmp/x', require('path').join(process.env.HOME, '.playground', 'roster.json'))"`,
      ],
      [
        "python3 code changing the roster's mode through lchmod",
        `python3 -c "import os; os.lchmod('$HOME/.playground/roster.json', 0)"`,
      ],
      [
        "node code changing the roster's owner through lchownSync",
        `node -e "require('fs').lchownSync('$HOME/.playground/roster.json', 1, 1)"`,
      ],
      [
        "python3 code setting the roster's flags",
        `python3 -c "import os; os.chflags('$HOME/.playground/roster.json', 2)"`,
      ],
      [
        "node code copying a file onto the roster through fs.cp",
        `node -e "require('fs').cp('/tmp/x', '$HOME/.playground/roster.json', () => {})"`,
      ],
      [
        "chmod -R on the data folder printed by a substitution",
        'chmod -R 000 "$(echo ~/.playground)"',
      ],
      ["rm -rf on the data folder printed by a substitution", 'rm -rf "$(echo ~/.playground)"'],
    ],
  },
]
