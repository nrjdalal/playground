import { type Group } from "./_shared"

// The forms #3130 names: the data folder held in a shell variable, an sh -c script or inline code run from the data folder, write calls outside the guard's write words, recursive writers on the folder, an xargs sh -c script handed the data folder through its positional parameters, and a cd into the data folder through a variable; the names file is never made, and rows are data, as refused-forms.ts says.
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
        "python3 code changing the roster's owner",
        `python3 -c "import os; os.chown('$HOME/.playground/roster.json', 1, 1)"`,
      ],
      [
        "node code copying a file onto the roster through cpSync",
        `node -e "require('fs').cpSync('/tmp/x', '$HOME/.playground/roster.json')"`,
      ],
      [
        "node code changing the roster's mode through fchmodSync",
        `node -e "const fs = require('fs'); fs.fchmodSync(fs.openSync('$HOME/.playground/roster.json', 'r'), 0)"`,
      ],
      [
        "python3 code moving a file onto the roster through pathlib's replace",
        `python3 -c "import pathlib; pathlib.Path('/tmp/x').replace('$HOME/.playground/roster.json')"`,
      ],
      [
        "python3 code copying a file onto the roster through shutil's bare copy",
        `python3 -c "from shutil import copy; copy('/tmp/x', '$HOME/.playground/roster.json')"`,
      ],
      [
        "perl code copying a file onto the roster through File::Copy",
        `perl -e "use File::Copy; copy('/tmp/x', '$HOME/.playground/roster.json')"`,
      ],
      [
        "ruby code moving a file onto the roster through FileUtils.mv",
        `ruby -e "require 'fileutils'; FileUtils.mv('/tmp/x', '$HOME/.playground/roster.json')"`,
      ],
      [
        "ruby code installing a file onto the roster through FileUtils.install",
        `ruby -e "require 'fileutils'; FileUtils.install('/tmp/x', '$HOME/.playground/roster.json')"`,
      ],
      [
        "python3 code running mv onto the roster as a subprocess",
        `python3 -c "import subprocess; subprocess.run(['mv', '/tmp/x', '$HOME/.playground/roster.json'])"`,
      ],
      [
        "python3 code running cp onto the roster as a subprocess",
        `python3 -c "import subprocess; subprocess.run(['cp', '/tmp/x', '$HOME/.playground/roster.json'])"`,
      ],
      [
        "node code running cp onto the roster through a command string",
        `node -e "require('child_process').execSync('cp /tmp/x $HOME/.playground/roster.json')"`,
      ],
      [
        "python3 code running cp onto the roster through os.system, its path joined on with +",
        `python3 -c "import os; p = os.path.expanduser('~/.playground/roster.json'); os.system('cp /tmp/x ' + p)"`,
      ],
      [
        "python3 code running mv onto the roster through os.system, its path joined on with %",
        `python3 -c "import os; p = os.path.expanduser('~/.playground/roster.json'); os.system('mv -f /tmp/x %s' % p)"`,
      ],
      [
        "python3 code running install onto the roster through os.system, its path in an f-string",
        `python3 -c "import os; p = os.path.expanduser('~/.playground/roster.json'); os.system(f'install /tmp/x {p}')"`,
      ],
      [
        "python3 code running cp onto the roster through os.system, its path filled by format",
        `python3 -c "import os; p = os.path.expanduser('~/.playground/roster.json'); os.system('cp {} {}'.format('/tmp/x', p))"`,
      ],
      [
        "node code running cp onto the roster through a template string",
        'node -e \'const p = process.env.HOME + "/.playground/roster.json"; require("child_process").execSync(`cp /tmp/x ${p}`)\'',
      ],
      [
        "python3 code running mv onto the roster through a shell=True command string",
        `python3 -c "import subprocess; subprocess.run('mv /tmp/x $HOME/.playground/roster.json', shell=True)"`,
      ],
      [
        "python3 code running cp onto the roster through os.popen",
        `python3 -c "import os; os.popen('cp /tmp/x $HOME/.playground/roster.json')"`,
      ],
      [
        "python3 code running install onto the roster through check_call",
        `python3 -c "import subprocess; subprocess.check_call(['install', '/tmp/x', '$HOME/.playground/roster.json'])"`,
      ],
      [
        "node code running cp onto the roster through spawnSync",
        `node -e "require('child_process').spawnSync('cp', ['/tmp/x', '$HOME/.playground/roster.json'])"`,
      ],
      [
        "node code running mv onto the roster through execFileSync",
        `node -e "require('child_process').execFileSync('mv', ['/tmp/x', '$HOME/.playground/roster.json'])"`,
      ],
      [
        "bun code running cp onto the roster through Bun's $ template",
        "bun -e 'await Bun.$`cp /tmp/x ${process.env.HOME}/.playground/roster.json`'",
      ],
      [
        "perl code running cp onto the roster through system with a list",
        `perl -e "system('cp', '/tmp/x', '$HOME/.playground/roster.json')"`,
      ],
      [
        "perl code running cp onto the roster through system with a command string",
        `perl -e "system 'cp /tmp/x $HOME/.playground/roster.json'"`,
      ],
      [
        "perl code running cp onto the roster through qx",
        `perl -e "qx{cp /tmp/x $HOME/.playground/roster.json}"`,
      ],
      [
        "perl code running cp onto the roster through a backtick",
        "perl -e '`cp /tmp/x $ENV{HOME}/.playground/roster.json`'",
      ],
      [
        "ruby code running cp onto the roster through system with a list",
        `ruby -e "system('cp', '/tmp/x', '$HOME/.playground/roster.json')"`,
      ],
      [
        "ruby code running cp onto the roster through %x",
        `ruby -e "%x(cp /tmp/x $HOME/.playground/roster.json)"`,
      ],
      [
        "php code running cp onto the roster through a backtick",
        `php -r '$h = getenv("HOME"); \`cp /tmp/x $h/.playground/roster.json\`;'`,
      ],
      [
        "perl code running cp onto the roster through exec with a command string",
        `perl -e "exec 'cp /tmp/x $HOME/.playground/roster.json'"`,
      ],
      [
        "ruby code running cp onto the roster through system with a command string",
        `ruby -e "system 'cp /tmp/x $HOME/.playground/roster.json'"`,
      ],
      [
        "python3 code running cp onto the roster through subprocess.getoutput",
        `python3 -c "import subprocess; subprocess.getoutput('cp /tmp/x $HOME/.playground/roster.json')"`,
      ],
      [
        "python3 code running mv onto the roster through subprocess.getstatusoutput",
        `python3 -c "import subprocess; subprocess.getstatusoutput('mv /tmp/x $HOME/.playground/roster.json')"`,
      ],
      [
        "php code running cp onto the roster through shell_exec",
        `php -r "shell_exec('cp /tmp/x $HOME/.playground/roster.json');"`,
      ],
      [
        "chmod -R on the data folder printed by a substitution",
        'chmod -R 000 "$(echo ~/.playground)"',
      ],
      [
        "rm -rf on a folder under the data folder printed by a substitution",
        'rm -rf "$(echo ~/.playground)/extensions/.no-such-folder"',
      ],
      [
        "a name into an xargs -I sh -c script that removes its first positional parameter, the data folder's item",
        `echo roster.json | xargs -I{} sh -c 'rm -f "$1"' _ ~/.playground/{}`,
      ],
      [
        "a names file into an xargs -I sh -c script that removes its first positional parameter, the data folder's item",
        `cat /tmp/no-such-names.txt | xargs -I{} sh -c 'rm -f "$1"' _ ~/.playground/{}`,
      ],
      [
        "a names file into an xargs -I sh -c script that removes $0, the data folder's item",
        `cat /tmp/no-such-names.txt | xargs -I{} sh -c 'rm -f "$0"' ~/.playground/{}`,
      ],
      [
        "a names file into an xargs -I sh -c script that removes its quoted positional parameters, the data folder's item",
        `cat /tmp/no-such-names.txt | xargs -I{} sh -c 'rm -f "$@"' _ ~/.playground/{}`,
      ],
      [
        "a names file into an xargs -I sh -c script that removes its unquoted positional parameters, the data folder's item",
        `cat /tmp/no-such-names.txt | xargs -I{} sh -c 'rm -f $*' _ ~/.playground/{}`,
      ],
      [
        "a names file into an xargs -I bash -c script that removes its second positional parameter, the data folder's item",
        `cat /tmp/no-such-names.txt | xargs -I{} bash -c 'rm -f "$2"' _ /tmp/a ~/.playground/{}`,
      ],
      [
        "a names file into an xargs -I sh -c script that redirects onto its first positional parameter, the data folder's item",
        `cat /tmp/no-such-names.txt | xargs -I{} sh -c 'echo x > "$1"' _ ~/.playground/{}`,
      ],
      [
        "a cd into the data folder held in a variable, then a removal of roster.json",
        "D=~/.playground; cd $D && rm roster.json",
      ],
      [
        "a cd into the data folder held in a quoted variable, then a forced removal of roster.json",
        'D=~/.playground; cd "$D"; rm -f roster.json',
      ],
      [
        "a cd into the data folder held in a variable, then python3 code removing roster.json",
        `D=~/.playground; cd $D && python3 -c "import os; os.remove('roster.json')"`,
      ],
      [
        "a cd into the data folder held in a braced variable, then a redirect onto roster.json",
        "D=~/.playground; cd ${D} && echo x > roster.json",
      ],
      [
        "a cd into the data folder held in an exported variable, then a move onto roster.json",
        "export D=~/.playground; cd $D && mv /tmp/x roster.json",
      ],
    ],
  },
]
