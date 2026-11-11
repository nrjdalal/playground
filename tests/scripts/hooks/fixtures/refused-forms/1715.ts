import type { Group } from "./_shared"

// The hc calls outside the trial world that no-raw-spawn refuses; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-raw-spawn"],
    rows: () => [
      ["hc running a command on the machine", "hc exec ls"],
      ["hc reading a file", "hc file read /etc/hosts"],
      ["hc typing keys into a terminal", "hc keys t1 enter"],
      ["hc sending past a draft", "hc send --force t1 hi"],
      ["hc starting its core", "hc server start"],
      ["hc starting a program", "hc run --bg claude"],
      ["herdr-core by its own name", "herdr-core server status"],
      ["hc in capitals", "HC keys t1 enter"],
      ["hc with its session word set before it", "env HC_SESSION=pgtrial hc send t1 hi"],
      ["an unread program running hc's exec", "$X exec ls"],
    ],
  },
]
