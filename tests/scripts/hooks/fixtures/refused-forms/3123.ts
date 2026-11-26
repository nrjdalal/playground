import { type Group } from "./_shared"

// #3123: xargs with no -I string runs a wrapper given no program of its own with xargs' input words as that program, and run-slot.sh's slot takes xargs' input as xargs splits and fills it, so the kill by name in the input is the command run; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-kill-by-name"],
    rows: () => [
      ["a kill by name nohup runs from xargs' here-string", "xargs nohup <<< 'pkill node'"],
      ["a kill by name timeout runs from xargs' here-string", "xargs timeout 5 <<< 'pkill node'"],
      ["a kill by name env runs from xargs' here-string", "xargs env <<< 'pkill node'"],
      ["a kill by name nohup runs from xargs' piped input", "echo pkill node | xargs nohup"],
      [
        "a kill by name nohup runs from BSD xargs -J's here-string, no word its string",
        "xargs -J % nohup <<< 'pkill node'",
      ],
      [
        "a kill by name timeout runs from BSD xargs -J's here-string, no word its string",
        "xargs -J % timeout 5 <<< 'pkill node'",
      ],
      [
        "a kill by name env runs from BSD xargs -J's here-string, no word its string",
        "xargs -J % env <<< 'killall node'",
      ],
      [
        "a kill by name nohup runs from BSD xargs -J's piped input, no word its string",
        "echo pkill node | xargs -J % nohup",
      ],
      [
        "a kill by name run-slot.sh runs from xargs' here-string after its --",
        "xargs ~/.playground/ops/run-slot.sh w -- <<< 'pkill node'",
      ],
      [
        "a kill by name run-slot.sh run as bash's script runs from xargs' here-string",
        "xargs bash ~/.playground/ops/run-slot.sh w -- <<< 'pkill node'",
      ],
      [
        "a kill by name run-slot.sh runs from xargs' piped input after its --",
        "echo pkill node | xargs ~/.playground/ops/run-slot.sh w --",
      ],
      [
        "a kill by name run-slot.sh runs from the second pair of words xargs -n2 hands it",
        "xargs -n2 ~/.playground/ops/run-slot.sh w -- <<< 'x y pkill node'",
      ],
      [
        "a kill by name run-slot.sh runs from the second line xargs -L1 hands it",
        "printf 'x\\n pkill node\\n' | xargs -L1 ~/.playground/ops/run-slot.sh w --",
      ],
      [
        "a kill by name run-slot.sh runs from the second item xargs -d , hands it",
        "xargs -d , ~/.playground/ops/run-slot.sh w -- <<< 'x,pkill node'",
      ],
      [
        "a kill by name run-slot.sh runs from the second item xargs -0 hands it",
        "xargs -0 ~/.playground/ops/run-slot.sh w -- < <(printf 'x\\0 pkill node')",
      ],
      [
        "a kill by name run-slot.sh runs from xargs -I's string in its slot",
        "xargs -I{} ~/.playground/ops/run-slot.sh w -- {} node <<< pkill",
      ],
      [
        "a kill by name run-slot.sh runs from BSD xargs -J's string in its slot",
        "xargs -J % ~/.playground/ops/run-slot.sh w -- % node <<< pkill",
      ],
      [
        "a kill by name nohup in run-slot.sh's slot runs from xargs' appended input",
        "xargs ~/.playground/ops/run-slot.sh w -- nohup <<< 'pkill node'",
      ],
    ],
  },
]
