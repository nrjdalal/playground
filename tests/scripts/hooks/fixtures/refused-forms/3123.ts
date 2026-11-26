import { type Group } from "./_shared"

// #3123: xargs with no -I string runs a wrapper given no program of its own with xargs' input words as that program, so the kill by name in the input is the command the wrapper runs; rows are data, as refused-forms.ts says.
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
    ],
  },
]
