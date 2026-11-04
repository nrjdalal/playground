import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["process home", "process data folder", "process worktree"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["rm of a substitution the hook cannot read", "rm -rf $(echo .p*)/.no-such-folder"],
      ["rm of a backtick substitution the hook cannot read", "rm -rf `echo .p*`/.no-such-folder"],
      ["rm of a variable the call never sets", "rm -rf $X/.no-such-folder"],
      ["mv of a quoted variable the call never sets", 'mv "$X" /tmp/y'],
      [
        "rm of a glob after a variable the call held",
        "X=.p; rm -rf $X*/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable's glob inside .playground",
        "X=e; rm -rf .playground/$X*/.no-such-folder",
        "process home",
      ],
      ["rm of a held path's glob", "X=.playground/e; rm -rf $X*/.no-such-folder", "process home"],
      [
        "git -c running a pager exported earlier in the call",
        `export P='rm -rf .playground/.no-such-folder'; true; cd \${HOME}; git -c core.pager="$P" log`,
        "process tmp",
      ],
      ["git -c with a value the call never sets", 'git -c core.pager="$P" log'],
      ["git -c attached with a value the call never sets", 'git -ccore.pager="$P" log'],
      [
        "rm of mktemp's folder made from a template in the root",
        'T=$(mktemp -d ~/.playground/extensions/x.XXXX); rm -rf "$T/.no-such-folder"',
      ],
      [
        "rm of mktemp's folder made with -p in the root",
        'T=$(mktemp -d -p ~/.playground/extensions); rm -rf "$T/.no-such-folder"',
      ],
      [
        "rm of mktemp's folder made with --tmpdir= in the root",
        'T=$(mktemp -d --tmpdir=$HOME/.playground/extensions); rm -rf "$T/.no-such-folder"',
      ],
      [
        "rm of mktemp's folder made with TMPDIR set inline",
        'T=$(TMPDIR=$HOME/.playground/extensions mktemp -d); rm -rf "$T/.no-such-folder"',
      ],
      [
        "rm of mktemp's folder made with TMPDIR exported",
        'export TMPDIR=$HOME/.playground/extensions; T=$(mktemp -d); rm -rf "$T/.no-such-folder"',
      ],
      ["rm of a pid-named path in the root", "rm -f ~/.playground/extensions/$$"],
      [
        "rm of mktemp's folder from a held variable's template in the root",
        'D=~/.playground/extensions; T=$(mktemp -d "$D/x.XXXX"); rm -rf "$T/.no-such-folder"',
      ],
      [
        "rm of mktemp's folder from a relative template inside the root",
        'T=$(mktemp -d x.XXXX); rm -rf "$T/.no-such-folder"',
        "extensions root",
      ],
      [
        "rm of a variable built on one the call sets again after",
        'S=extensions; T="$S/.no-such-folder"; S=/tmp; rm -rf $T',
        "process data folder",
      ],
      [
        "rm of a variable set again where the shell skips it",
        "X=extensions/.no-such-folder || X=/tmp/a; rm -rf $X",
        "process data folder",
      ],
      [
        "rm of a variable set again in a pipeline's subshell",
        "X=extensions/.no-such-folder; X=/tmp/a | X=/tmp/b; rm -rf $X",
        "process data folder",
      ],
      [
        "rm of a variable set again in a backgrounded subshell",
        "X=extensions/.no-such-folder; X=/tmp/a & rm -rf $X",
        "process data folder",
      ],
      [
        "rm of a variable a quoted assignment, a command the shell runs, never sets",
        '"X=/tmp/a"; rm -rf ${X}extensions/.no-such-folder',
        "process data folder",
      ],
      [
        "rm after a ; of a variable an && chain set, which the shell may skip",
        "false && X=/tmp/a; rm -rf ${X}extensions/.no-such-folder",
        "process data folder",
      ],
      [
        "rm of a variable set only in a function the line never calls",
        "f() { true; X=/tmp/a; }; rm -rf ${X}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable set only in an untaken if branch",
        "if false; then true; X=/tmp/a; fi; rm -rf ${X}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable set only in an untaken if branch on its own line",
        "if false; then\nX=/tmp/a\nfi\nrm -rf ${X}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable set only in a loop body that never runs",
        "while false; do true; X=/tmp/a; done; rm -rf ${X}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable set only in an untaken case arm",
        "case a in b) true; X=/tmp/a;; esac; rm -rf ${X}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable set only in a group behind a failing &&",
        "false && { true; X=/tmp/a; }; rm -rf ${X}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable read sets by a name spelled in pieces",
        "XY=/tmp/a; read X\\Y <<< exten; rm -rf ${XY}sions/.no-such-folder",
        "process data folder",
      ],
      [
        "rm of a variable eval sets by a name it builds",
        'XY=/tmp/a; N=X; eval "${N}Y=exten"; rm -rf ${XY}sions/.no-such-folder',
        "process data folder",
      ],
      [
        "rm of the parameter _, which the shell sets itself after each command",
        "_=/tmp/a; rm -rf ${_}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of the parameter RANDOM, which the shell sets itself to digits",
        "RANDOM=/tmp/a; rm -rf ${RANDOM}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a variable zsh's ::= expansion sets again",
        "X=/tmp/a; : ${X::=}; rm -rf ${X}.playground/./extensions/.no-such-folder",
        "process home",
      ],
      [
        "rm of a held variable on a line that sets IFS, which bash splits it at",
        "IFS=q; X=.no-such-folderq.playground/./extensions/.no-such-folder; rm -rf $X",
        "process home",
      ],
      [
        "rm of a variable the call appends to",
        "X=ext; X+=ensions/.no-such-folder; rm -rf $X",
        "process data folder",
      ],
      [
        "rm of a variable printf -v sets again",
        "X=/tmp/a; printf -v X %s%s exten sions/.no-such-folder; rm -rf $X",
        "process data folder",
      ],
      [
        "rm of a variable read sets again",
        "X=/tmp/a; read X <<< exten; rm -rf ${X}sions/.no-such-folder",
        "process data folder",
      ],
      [
        "rm of a variable a for loop sets again",
        "X=/tmp/a; for X in exten; do rm -rf ${X}sions/.no-such-folder; done",
        "process data folder",
      ],
      [
        "rm under a TMPDIR a for loop sets",
        "for TMPDIR in ext; do rm -rf ${TMPDIR}ensions/.no-such-folder; done",
        "process data folder",
      ],
      [
        "rm of mktemp's dry-run name",
        'T=$(mktemp -u .playgrounX); rm -rf "$T/extensions/.no-such-folder"',
        "process home",
      ],
      [
        "rm of mktemp's --dry-run name",
        'T=$(mktemp --dry-run .playgrounX); rm -rf "$T/extensions/.no-such-folder"',
        "process home",
      ],
      [
        "rm under xargs fed by a command the hook cannot read",
        "ls -a | xargs -I% rm -rf %/.no-such-folder",
        "process data folder",
      ],
    ],
  },
]
