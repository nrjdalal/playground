import { type Group, type Paths, type Row } from "./_shared"

// #2522: a glob-option switch on a line ssh runs remotely or feeds a remote shell is refused rather than read, so a spelling the per-name reading never listed is refused too; #2487's spellings are 2459.ts's rows; rows are data, as refused-forms.ts says.

// no-extensions-write: a switch on the local side of the line, and a remote line or fed script with none
const controls = (): Row[] => [
  ["a dotglob on the local side before a remote uptime", "shopt -s dotglob; ssh box uptime"],
  ["a remote star glob with no switch on the line", "ssh box 'ls */notes'"],
  ["a script with no switch piped to a remote bash", "echo 'df -h' | ssh box bash"],
  ["a strict-mode header on a remote line", "ssh box 'set -euo pipefail; ls */notes'"],
  [
    "a strict-mode header in a heredoc fed to a remote bash",
    "ssh box bash -s <<'EOF'\nset -euo pipefail\nls */notes\nEOF",
  ],
  [
    "awk's *100/(…) in a heredoc fed to a remote bash, which a * before a digit keeps from reading as a qualifier",
    "ssh box bash -s <<'EOF'\nawk '{ print (a[2]-a[1])*100/(b[2]-b[1]) }' f\nEOF",
  ],
]

const refused = (): Row[] => [
  [
    "a remote touch through a ? glob after ksh93's FIGNORE, a name the per-name reading never listed",
    "ssh box 'FIGNORE=x; touch ?playground/extensions/y'",
  ],
  [
    "a remote touch through a ? glob after a setopt naming no dot option",
    "ssh box 'setopt EXTENDED_GLOB; touch ?playground/extensions/y'",
  ],
  [
    "a remote touch through a ? glob after a shopt naming no dot option",
    "ssh box 'shopt -s nocaseglob; touch ?playground/extensions/y'",
  ],
  [
    "a remote touch through a ? glob after a set -o",
    "ssh box 'set -o KSH_GLOB; touch ?playground/extensions/y'",
  ],
  [
    "a remote touch through a ? glob after an unsetopt",
    "ssh box 'unsetopt BARE_GLOB_QUAL; touch ?playground/extensions/y'",
  ],
  [
    "a remote touch through a ? glob after an emulate",
    "ssh box 'emulate ksh; touch ?playground/extensions/y'",
  ],
  [
    "a remote touch through a ? glob in a zsh started with -o",
    `ssh box "zsh -o KSH_GLOB -c 'touch ?playground/extensions/y'"`,
  ],
  [
    "a remote touch through a ? glob after a zsh options key",
    "ssh box 'options[nomatch]=off; touch ?playground/extensions/y'",
  ],
  [
    "a remote touch through a ? glob with a zsh (#q) qualifier",
    "ssh box 'touch ?playground(#qN)/extensions/y'",
  ],
  [
    "a remote touch through a ? glob after FIGNORE in a heredoc fed to a remote bash",
    "ssh box bash -s <<'EOF'\nFIGNORE=x\ntouch ?playground/extensions/y\nEOF",
  ],
  [
    "a remote touch through a ? glob after FIGNORE piped to a remote bash",
    "echo 'FIGNORE=x; touch ?playground/extensions/y' | ssh box bash",
  ],
  [
    "a remote touch through a * glob with BASHOPTS set by ssh's SetEnv",
    "ssh -o SetEnv=BASHOPTS=dotglob box 'touch */extensions/x'",
  ],
  [
    "a remote touch through a ? glob with GLOBIGNORE set by an attached SetEnv",
    "ssh -oSetEnv=GLOBIGNORE=x box 'touch ?playground/extensions/y'",
  ],
  [
    "a remote touch through a * glob with BASHOPTS sent by ssh's SendEnv",
    "ssh -o SendEnv=BASHOPTS box 'touch */extensions/x'",
  ],
  [
    "a remote touch through a * glob with a SendEnv pattern",
    "ssh -o 'SendEnv=BASH*' box 'touch */extensions/x'",
  ],
  [
    "a heredoc fed to a remote bash with BASHOPTS set by SetEnv",
    "ssh -o SetEnv=BASHOPTS=dotglob box bash -s <<'EOF'\ntouch */extensions/x\nEOF",
  ],
]

export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-extensions-write"],
    rows: (_paths: Paths) => [...controls(), ...refused()],
  },
]

export const allowed: string[] = controls().map(([what]) => what)
