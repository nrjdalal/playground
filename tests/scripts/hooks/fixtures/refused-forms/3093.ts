import { type Group } from "./_shared"

// The forms #3093 names: an xargs -I string under the data folder fed input the guard cannot see, inline code naming the data folder and roster.json apart or removing the roster by a call, and writers fed the roster through xargs; the names file is never made, and rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    // from a folder that holds no roster, so only the -I string's own folder reaches toward it
    folders: ["process tmp"],
    guards: ["no-roster-write"],
    rows: () => [
      [
        "a names file's contents into an xargs -I string that removes each name in the data folder",
        "cat /tmp/no-such-names.txt | xargs -I{} rm ~/.playground/{}",
      ],
      [
        "a names file redirected into an xargs -I string that removes each name in the data folder",
        "xargs -I{} rm ~/.playground/{} < /tmp/no-such-names.txt",
      ],
      [
        "a sorted names file into an xargs -I string that removes each name in the data folder",
        "cat /tmp/no-such-names.txt | sort | xargs -I{} rm ~/.playground/{}",
      ],
      [
        "an xargs -a names file into an -I string that removes each name in the data folder",
        "xargs -a /tmp/no-such-names.txt -I{} rm ~/.playground/{}",
      ],
      [
        "a names file into an xargs -I string, its own mark, that removes each quoted name in the data folder",
        'cat /tmp/no-such-names.txt | xargs -I% rm "$HOME/.playground/%"',
      ],
      [
        "a names file into an xargs -I string that moves a file onto each name in the data folder",
        "cat /tmp/no-such-names.txt | xargs -I{} mv /tmp/x ~/.playground/{}",
      ],
      [
        "a names file into an xargs -I string whose sh -c script removes each name in the data folder",
        "cat /tmp/no-such-names.txt | xargs -I{} sh -c 'rm ~/.playground/{}'",
      ],
      [
        "a find's printed names into an xargs -I string that removes each name in the data folder",
        "find /tmp/no-such-dir -name roster.json -printf '%f\\n' | xargs -I{} rm ~/.playground/{}",
      ],
      [
        "a find's basenames into an xargs -I string that removes each name in the data folder",
        "find /tmp/no-such-dir -type f -exec basename {} \\; | xargs -I{} rm ~/.playground/{}",
      ],
      [
        "a find's paths into an xargs -I string that removes each one under the data folder",
        "find /tmp/no-such-dir -type f | xargs -I{} rm ~/.playground/{}",
      ],
      [
        "a names file into an xargs -I python3 whose code removes each name in the data folder",
        `cat /tmp/no-such-names.txt | xargs -I{} python3 -c "import os; os.remove('$HOME/.playground/{}')"`,
      ],
      [
        "a names file into an xargs -I node whose code unlinks each name in the data folder",
        `cat /tmp/no-such-names.txt | xargs -I{} node -e "require('fs').unlinkSync('$HOME/.playground/{}')"`,
      ],
      [
        "a names file into an xargs -I perl whose code unlinks each name in the data folder by its HOME",
        `cat /tmp/no-such-names.txt | xargs -I{} perl -e 'unlink "$ENV{HOME}/.playground/{}"'`,
      ],
      [
        "a names file into an xargs -I ruby whose code deletes each name in the data folder by its HOME",
        `cat /tmp/no-such-names.txt | xargs -I{} ruby -e 'File.delete(ENV["HOME"] + "/.playground/{}")'`,
      ],
      [
        "a names file into an xargs -I bun whose code writes over each name in the data folder",
        `cat /tmp/no-such-names.txt | xargs -I{} bun -e "await Bun.write('$HOME/.playground/{}', '')"`,
      ],
      [
        "a names file into a while read loop that removes each name in the data folder",
        "cat /tmp/no-such-names.txt | while read f; do rm ~/.playground/$f; done",
      ],
      [
        "a names file redirected into a while read loop that removes each name in the data folder",
        'while read -r f; do rm "$HOME/.playground/$f"; done < /tmp/no-such-names.txt',
      ],
    ],
  },
  {
    folders: ["process home"],
    guards: ["no-roster-write"],
    rows: () => [
      [
        "a python os.system call that moves into the data folder and removes roster.json",
        `python3 -c "import os; os.system('cd $HOME/.playground; rm roster.json')"`,
      ],
      [
        "a node chdir into the data folder and an unlinkSync of roster.json",
        `node -e "process.chdir('$HOME/.playground'); require('fs').unlinkSync('roster.json')"`,
      ],
      [
        "a perl chdir into the data folder and an unlink of roster.json",
        `perl -e 'chdir "$ENV{HOME}/.playground"; unlink "roster.json"'`,
      ],
      [
        "a Bun.write onto the data folder and roster.json joined in the code",
        `bun -e "await Bun.write(require('path').join('$HOME/.playground', 'roster.json'), '{}')"`,
      ],
      [
        "a python os.system rm of HOME, the data folder and roster.json joined in the code",
        `python3 -c "import os; os.system('rm ' + os.environ['HOME'] + '/.playground/' + 'roster.json')"`,
      ],
      [
        "a python chdir into the data folder and an os.remove of roster.json",
        `python3 -c "import os; os.chdir('$HOME/.playground'); os.remove('roster.json')"`,
      ],
      [
        "a ruby chdir into the data folder and a File.delete of roster.json",
        `ruby -e 'Dir.chdir(ENV["HOME"] + "/.playground"); File.delete("roster.json")'`,
      ],
      [
        "a python os.remove of the data folder's roster.json named by its own variable",
        `python3 -c "import os; os.remove(os.environ['PLAYGROUND_DATA_DIR'] + '/roster.json')"`,
      ],
      [
        "a python os.remove of the roster",
        `python3 -c "import os; os.remove('$HOME/.playground/roster.json')"`,
      ],
      [
        "a ruby File.delete of the roster",
        `ruby -e 'File.delete(ENV["HOME"] + "/.playground/roster.json")'`,
      ],
      [
        "a python shutil.move of the roster out of the data folder",
        `python3 -c "import shutil; shutil.move('$HOME/.playground/roster.json', '/tmp/r')"`,
      ],
      [
        "a listing of the roster into an xargs that sets its immutable flag",
        "ls ~/.playground/roster.json | xargs chflags uchg",
      ],
      [
        "a listing of the roster into an xargs that compresses it in its place with pigz",
        "ls ~/.playground/roster.json | xargs pigz",
      ],
      [
        "a listing of the roster into an xargs that compresses it with zstd and removes it",
        "ls ~/.playground/roster.json | xargs zstd --rm",
      ],
      ["chflags setting the roster's immutable flag", "chflags uchg ~/.playground/roster.json"],
      ["pigz compressing the roster in its place", "pigz ~/.playground/roster.json"],
      ["zstd compressing the roster and removing it", "zstd --rm ~/.playground/roster.json"],
    ],
  },
]
