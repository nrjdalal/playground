import type { Group } from "./_shared"

// #665's D4 (a): with every session in herdr, no factory session calls cmux, so no-raw-spawn refuses every cmux call but its help or version, these among them, each run on canary.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-raw-spawn"],
    rows: () => [
      ["a cmux read", "cmux tree --workspace workspace:3"],
      ["a cmux split with a plain shell", "cmux new-split right --command zsh --focus false"],
      ["a cmux close", "cmux close-surface --surface surface:4"],
      ["keystrokes into a cmux surface", 'cmux send --surface surface:2 -- "hello"'],
      ["a cmux agent message", 'cmux agent message builder "done"'],
      ["a cmux browser surface", "cmux new-surface --type browser --url https://example.com"],
      ["a cmux fork of a Codex session", "cmux fork codex 0f1e2d"],
      ["a cmux subcommand's help", "cmux agent --help"],
      ["cmux by its path", "/Applications/cmux.app/Contents/Resources/bin/cmux tree --all"],
      ["cmux behind env", "env CMUX_QUIET=1 cmux tree --all"],
      ["a bare cmux", "cmux"],
      ["cmux in capitals", "CMUX tree"],
      ["cmux capitalised", "Cmux tree --all"],
      ["cmux in capitals by its path", "/usr/local/bin/CMUX tree"],
      ["cmux in capitals opening claude", "CMUX new-workspace --command claude"],
      [
        "a program it cannot read before a cmux split (D4's form 11)",
        "$X new-split right --workspace workspace:3",
      ],
    ],
  },
]
