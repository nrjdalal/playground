import { type Group, type Row } from "./_shared"

// #2490: the words piped into ssh, or ssh's own here-string or heredoc, reach a remote xargs as its stdin, as they reach its local twin's, each passing form beside its nearest refused twin; rows are data, as refused-forms.ts says.

// no-extensions-write: a remote xargs that reads no root path, none of ssh's stdin, or a stdin the hook cannot read, which its local twin passes too
const extensionsControls = (): Row[] => [
  ["a path outside the root piped to a remote xargs touch", "echo notes/x | ssh box xargs touch"],
  [
    "the root's path piped to ssh -n, whose remote xargs reads /dev/null",
    "echo .playground/extensions/.no-such-file | ssh -n box xargs touch",
  ],
  [
    "the root's path piped to ssh, whose remote xargs reads its own file",
    "echo .playground/extensions/.no-such-file | ssh box 'xargs touch < list'",
  ],
  [
    "a listing the hook cannot read piped to a remote xargs touch, as its local twin passes",
    "ls | ssh box xargs touch",
  ],
  [
    "a file ssh hands a remote xargs touch, as its local twin passes (PG-2553)",
    "ssh box xargs touch < list",
  ],
  [
    "a path outside the root in a here-string ssh hands a remote xargs touch",
    "ssh box xargs touch <<< notes/x",
  ],
  [
    "a path outside the root in a heredoc ssh hands a remote xargs touch",
    "ssh box xargs touch <<EOF\nnotes/x\nEOF",
  ],
  [
    "a path outside the root in a quoted heredoc ssh hands a remote xargs touch",
    "ssh box xargs touch <<'EOF'\nnotes/x\nEOF",
  ],
]

// no-extensions-write: the root's path in the words a remote xargs reads from ssh's stdin
const extensionsRefused = (): Row[] => [
  [
    "the root's path piped to a remote xargs touch",
    "echo .playground/extensions/.no-such-file | ssh box xargs touch",
  ],
  [
    "the root's path piped to a remote xargs -r touch",
    "echo .playground/extensions/.no-such-file | ssh box xargs -r touch",
  ],
  [
    "the root's path printed into a remote xargs touch",
    "printf '%s\\n' .playground/extensions/.no-such-file | ssh box xargs touch",
  ],
  [
    "the root's path in a here-string ssh hands a remote xargs touch",
    "ssh box xargs touch <<< .playground/extensions/.no-such-file",
  ],
  [
    "the root's path in a heredoc ssh hands a remote xargs touch",
    "ssh box xargs touch <<EOF\n.playground/extensions/.no-such-file\nEOF",
  ],
  [
    "the root's path in a quoted heredoc ssh hands a remote xargs touch",
    "ssh box xargs touch <<'EOF'\n.playground/extensions/.no-such-file\nEOF",
  ],
]

export const groups: Group[] = [
  {
    folders: ["checkout", "home", "tmp"],
    guards: ["no-extensions-write"],
    rows: () => [...extensionsControls(), ...extensionsRefused()],
  },
]

export const allowed: string[] = extensionsControls().map(([what]) => what)
