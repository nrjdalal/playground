import { type Group, NEVER_MADE, type Paths, type Row } from "./_shared"

// #2459 items 1 and 2: ssh's remote line read from the login's home, the stdin ssh hands a remote shell read as its script, and the -o values ssh runs here, each passing form beside its nearest refused twin; rows are data, as refused-forms.ts says.

// no-extensions-write: remote lines that write outside the root from the home, stdin a remote command reads as data or never gets, and a ProxyCommand that writes nothing
const extensionsControls = ({ DATA, HOME }: Paths): Row[] => [
  [
    "Ops' peer-folder check: a listing of the data folder fed to a remote bash from a file",
    `ssh spark-9dfb bash -s < ${HOME}/peer-check.sh`,
  ],
  [
    "Ops' peer-folder check: a listing of the data folder fed to a remote bash as a here-string",
    `ssh spark-9dfb bash -s <<< 'ls ${DATA}'`,
  ],
  ["a touch in the remote home's notes folder over ssh", "ssh localhost 'touch notes/x'"],
  [
    "a listing of the remote home's data folder after a remote cd",
    "ssh localhost 'cd .playground && ls'",
  ],
  ["a copy into the remote home's notes folder over ssh", "ssh localhost cp a notes/x"],
  ["a text piped to a remote cat", "echo hi | ssh box cat > out.txt"],
  ["a remote listing reading /dev/null", "ssh box ls < /dev/null"],
  ["a script piped to a remote bash -n", "echo 'df -h' | ssh box bash -n"],
  ["a script piped to a remote bash that writes nothing", "echo 'df -h' | ssh box bash"],
  [
    "a write's text piped to ssh -n, whose remote side reads /dev/null",
    "echo 'touch .playground/extensions/x' | ssh -n host bash",
  ],
  [
    "a write's text piped to a remote cat that saves it as data",
    "echo 'touch .playground/extensions/x' | ssh box 'cat > notes.txt'",
  ],
  ["a ProxyCommand that connects by nc", "ssh -o ProxyCommand='nc %h %p' host ls"],
  ["a remote uptime after -o options that run nothing", "ssh -o Port=2222 -o User=me box uptime"],
  [
    "docker's format templates in a remote line, braces with no list read from the home",
    `ssh spark-9dfb 'docker ps --format "{{.Names}}"; docker images --format "{{.Repository}}:{{.Tag}} {{.Size}}"'`,
  ],
  [
    "a python print in a remote line, its parentheses read from the home",
    `ssh spark-9dfb 'python3 -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"'`,
  ],
  [
    "a bracket pattern in a remote pgrep, read from the home",
    "ssh spark-9dfb 'pgrep -af [c]laude'",
  ],
  [
    "a zsh group of one plain name in a remote line, read from the home",
    `ssh spark-9dfb "printf '%s\\n' 'profile x flags=(unconfined) {'"`,
  ],
  [
    "a star glob in the remote home, which no dot-led name matches",
    "ssh spark-9dfb 'ls */extensions'",
  ],
]

const extensionsRefused = ({ HOME, ROOT }: Paths): Row[] => [
  [
    "a write under the root fed to a remote bash from a file",
    `ssh spark-9dfb bash -s < ${HOME}/peer-write.sh`,
  ],
  [
    "a write under the root fed to a remote bash as a here-string",
    `ssh spark-9dfb bash -s <<< 'touch ${ROOT}/x'`,
  ],
  [
    "a reader piped to a remote bash inside a here-string, which roots the line",
    "ssh spark-9dfb bash -s <<< 'cat .playground/extensions/x | bash'",
  ],
  ["a remote touch into the root from the home", "ssh localhost 'touch .playground/extensions/x'"],
  [
    "a remote touch into the root after a remote cd from the home",
    "ssh localhost 'cd .playground && touch extensions/x'",
  ],
  ["a remote copy into the root from the home", "ssh localhost cp a .playground/extensions/x"],
  [
    "a remote commit after a remote cd into the root",
    "ssh localhost 'cd .playground/extensions; git commit -am x'",
  ],
  [
    "a remote touch into the root after -p and -i",
    "ssh -p 22 -i key localhost 'touch .playground/extensions/x'",
  ],
  ["a remote touch into the root after --", "ssh localhost -- 'touch .playground/extensions/x'"],
  [
    "a remote touch into the root after an option past the host",
    "ssh localhost -p 22 'touch .playground/extensions/x'",
  ],
  [
    "a RemoteCommand touching the root",
    "ssh -o RemoteCommand='touch .playground/extensions/x' localhost",
  ],
  ["a write piped to a remote bash", "echo 'touch .playground/extensions/x' | ssh localhost bash"],
  [
    "a write piped to ssh with no remote command, which the login shell reads",
    "echo 'cd .playground && touch extensions/x' | ssh localhost",
  ],
  [
    "a write in a here-string to a remote bash",
    "ssh localhost bash <<< 'touch .playground/extensions/x'",
  ],
  [
    "a write in a heredoc to a remote bash",
    "ssh localhost bash <<'EOF'\ntouch .playground/extensions/x\nEOF",
  ],
  [
    "a write piped to a remote command the hook cannot read",
    `echo 'touch .playground/extensions/x' | ssh localhost "$REMOTE"`,
  ],
  [
    "a write piped to a remote bash after -o BatchMode",
    "echo 'touch .playground/extensions/x' | ssh -o BatchMode=yes localhost bash",
  ],
  [
    "a write piped to a remote sudo bash",
    "echo 'touch .playground/extensions/x' | ssh localhost sudo bash",
  ],
  [
    "a remote touch into the root on another host, read from the home",
    "ssh spark-9dfb 'touch .playground/extensions/x'",
  ],
  ["a remote touch through a dot-led glob in the home", "ssh spark-9dfb 'touch .p*/extensions/x'"],
  [
    "a remote chmod of a ? glob spelling the data folder",
    "ssh spark-9dfb 'chmod -R 777 .pl?yground'",
  ],
  [
    "a remote touch through a brace list spelling the data folder",
    "ssh spark-9dfb 'touch {.playground,x}/extensions/y'",
  ],
  [
    "a remote touch through a star glob after dotglob",
    "ssh spark-9dfb 'shopt -s dotglob; touch */extensions/x'",
  ],
  ["a remote touch through zsh's dot qualifier", "ssh spark-9dfb 'touch *(D)/extensions/x'"],
  [
    "a remote touch through a zsh group spelling the data folder",
    "ssh spark-9dfb 'touch (.playground|x)/extensions/y'",
  ],
  ["a ProxyCommand touching the root", `ssh -o ProxyCommand='touch ${ROOT}/x' host true`],
  [
    "an attached -oProxyCommand touching the root",
    `ssh -oProxyCommand='touch ${ROOT}/x' host true`,
  ],
  [
    "a LocalCommand touching the root",
    `ssh -o PermitLocalCommand=yes -o LocalCommand='touch ${ROOT}/x' host true`,
  ],
  [
    "a KnownHostsCommand touching the root, its value after a blank",
    `ssh -o 'KnownHostsCommand touch ${ROOT}/x' host true`,
  ],
  ["a ProxyCommand the hook cannot read", `ssh -o ProxyCommand="$CMD" host true`],
  ["a -o the hook cannot read", `ssh -o "$OPT" host true`],
]

export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-extensions-write"],
    rows: (paths) => [...extensionsControls(paths), ...extensionsRefused(paths)],
  },
  {
    folders: ["checkout", "process worktree"],
    guards: ["no-raw-delete"],
    rows: () => [
      ["a recursive rm piped to a remote sh", `echo 'rm -rf ${NEVER_MADE}' | ssh localhost sh`],
    ],
  },
]

export const allowed: string[] = extensionsControls(new Proxy({} as Paths, { get: () => "" })).map(
  ([what]) => what,
)
