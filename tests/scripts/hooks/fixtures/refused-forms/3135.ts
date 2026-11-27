import type { Group } from "./_shared"

// #3135: a gh pr merge xargs gives words from its input, appended or in place of its -I string, is placed by the pull request URL or -R there, so a merge of this repository's pull request (acme-labs/demo here, the checkout's origin) fed through xargs stays refused whatever -R or the checkout names, and so does one whose input names it anywhere, whatever batch xargs cuts; an input the hook cannot read is refused too, and so is gh given one where its subcommand may come from it, run-slot running it past any wrapper too, a gh among the wrappers' values or as run-slot's <who> included, while a program that only names gh, and gh's help, run; each twin names acme-blue/app, a repository outside the factory, and runs. Rows are data, as refused-forms.ts says.
const OURS = "https://github.com/acme-labs/demo/pull/5"
const THEIRS = "https://github.com/acme-blue/app/pull/5"
// Each wrapper shell.ts unwraps, with a value where it takes one, as run-slot runs it after its --
const SLOT_WRAPPERS = [
  "-",
  "builtin",
  "busybox",
  "caffeinate -i",
  "chrt 0",
  "command",
  "doas -u x",
  "env",
  "exec -a x",
  "flock /tmp/l",
  "genv",
  "gnice",
  "gnohup",
  "gstdbuf -o0",
  "gtimeout 5",
  "ionice -c 3",
  "nice -n 5",
  "nocorrect",
  "noglob",
  "nohup",
  "pkexec",
  "repeat 3",
  "setsid",
  "stdbuf -o0",
  "sudo -u x",
  "taskset 1",
  "time -p",
  "timeout 5",
]
// gh as a wrapper's value or positional word before run-slot's gh, which gh's words are read past
const GH_VALUES = [
  "bunx --cwd gh",
  "caffeinate -t gh",
  "caffeinate -w gh",
  "doas -u gh",
  "env --unset gh",
  "env -C gh",
  "env -P gh",
  "env -u gh",
  "env -u gh timeout -s gh 5",
  "exec -a gh",
  "flock -w gh x",
  "flock gh",
  "ionice -c gh",
  "mise exec gh --",
  "nice -n gh",
  "nohup env -u gh",
  "npx -p gh",
  "repeat gh",
  "stdbuf -o gh",
  "sudo -g gh",
  "sudo -u gh",
  "taskset gh",
  "time -f gh",
  "time -o gh",
  "timeout --signal=gh 5",
  "timeout -k gh 5",
  "timeout -s gh 5",
]

export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-protected-push"],
    rows: () => [
      [
        "this repository's URL appended past -R",
        `echo ${OURS} | xargs gh pr merge -R acme-blue/app`,
      ],
      ["an org URL appended past -R", `echo ${THEIRS} | xargs gh pr merge -R acme-blue/app`],
      [
        "this repository's URL appended past --repo",
        `echo ${OURS} | xargs gh pr merge --merge --repo acme-blue/app`,
      ],
      [
        "an org URL appended past --repo",
        `echo ${THEIRS} | xargs gh pr merge --merge --repo acme-blue/app`,
      ],
      [
        "this repository's URL appended past gh's own -R",
        `echo ${OURS} | xargs gh -R acme-blue/app pr merge --auto`,
      ],
      [
        "an org URL appended past gh's own -R",
        `echo ${THEIRS} | xargs gh -R acme-blue/app pr merge --auto`,
      ],
      [
        "this repository's URL one item at a time",
        `printf '%s\\n' ${OURS} | xargs -n1 gh pr merge -R acme-blue/app`,
      ],
      [
        "an org URL one item at a time",
        `printf '%s\\n' ${THEIRS} | xargs -n1 gh pr merge -R acme-blue/app`,
      ],
      [
        "this repository's URL beside a number",
        `echo 5 ${OURS} | xargs -n1 gh pr merge -R acme-blue/app`,
      ],
      ["an org number appended", "echo 5 | xargs gh pr merge -R acme-blue/app"],
      [
        "this repository's URL split at nul",
        `echo ${OURS} | xargs -0 gh pr merge -R acme-blue/app`,
      ],
      ["an org URL split at nul", `echo ${THEIRS} | xargs -0 gh pr merge -R acme-blue/app`],
      [
        "this repository's URL quoted to echo",
        `echo "${OURS}" | xargs gh pr merge -R acme-blue/app`,
      ],
      ["an org URL quoted to echo", `echo "${THEIRS}" | xargs gh pr merge -R acme-blue/app`],
      [
        "this repository named by an appended -R",
        "echo -R acme-labs/demo 5 | xargs gh pr merge -R acme-blue/app",
      ],
      [
        "an org named by an appended -R",
        "echo -R acme-blue/app 5 | xargs gh pr merge -R acme-blue/app",
      ],
      [
        "this repository's URL in place of -I's string",
        `echo ${OURS} | xargs -I{} gh pr merge {} -R acme-blue/app`,
      ],
      [
        "an org URL in place of -I's string",
        `echo ${THEIRS} | xargs -I{} gh pr merge {} -R acme-blue/app`,
      ],
      [
        "this repository's URL appended past a -J string no word is",
        `echo ${OURS} | xargs -J % gh pr merge -R acme-blue/app`,
      ],
      [
        "an org URL appended past a -J string no word is",
        `echo ${THEIRS} | xargs -J % gh pr merge -R acme-blue/app`,
      ],
      ["an input the hook cannot read by redirect", "xargs gh pr merge -R acme-blue/app < list"],
      ["an input the hook cannot read by pipe", "cat list | xargs gh pr merge -R acme-blue/app"],
      ["an input the hook cannot read by -a", "xargs -a list gh pr merge -R acme-blue/app"],
      [
        "an input that holds a quote",
        `printf '"%s"\\n' ${THEIRS} | xargs gh pr merge -R acme-blue/app`,
      ],
      ["an unread input after pr alone", "cat list | xargs gh pr -R acme-blue/app"],
      ["an unread input after pr alone by redirect", "xargs gh pr -R acme-blue/app < list"],
      ["an unread input with no subcommand", "cat list | xargs gh -R acme-blue/app"],
      ["an unread input after pr alone in its checkout", "cat list | xargs gh pr"],
      ["an unread input as pr's subcommand", "cat list | xargs -I{} gh pr {}"],
      [
        "an unread input as pr's subcommand past -R",
        "cat list | xargs -I{} gh pr {} -R acme-blue/app",
      ],
      [
        "an unread input as gh's subcommand past -R",
        "cat list | xargs -I{} gh {} -R acme-blue/app",
      ],
      [
        "this repository's merge given to pr alone",
        `echo merge ${OURS} | xargs gh pr -R acme-blue/app`,
      ],
      ["an org merge given to pr alone", `echo merge ${THEIRS} | xargs gh pr -R acme-blue/app`],
      [
        "this repository's merge given to gh alone",
        `echo pr merge ${OURS} | xargs gh -R acme-blue/app`,
      ],
      ["an org merge given to gh alone", `echo pr merge ${THEIRS} | xargs gh -R acme-blue/app`],
      ["a merge given to pr alone in its checkout", "echo merge | xargs gh pr"],
      ["a merge in place of pr's subcommand in its checkout", "echo merge | xargs -I{} gh pr {}"],
      ["an unread input to a typed view", "cat list | xargs gh pr view -R acme-labs/demo"],
      [
        "this repository's -R in a batch",
        `echo "-R acme-labs/demo 5 -R acme-blue/app 6" | xargs -n3 gh pr merge -R acme-blue/app`,
      ],
      [
        "an org's -R in a batch",
        `echo "-R acme-blue/app 5 -R acme-blue/app 6" | xargs -n3 gh pr merge -R acme-blue/app`,
      ],
      [
        "this repository's --repo in a batch",
        `echo "--repo acme-labs/demo 5 --repo acme-blue/app 6" | xargs -n3 gh pr merge -R acme-blue/app`,
      ],
      [
        "an org's --repo in a batch",
        `echo "--repo acme-blue/app 5 --repo acme-blue/app 6" | xargs -n3 gh pr merge -R acme-blue/app`,
      ],
      [
        "this repository's --repo= in a batch",
        `echo "--repo=acme-labs/demo 5 --repo=acme-blue/app 6" | xargs -n2 gh pr merge -R acme-blue/app`,
      ],
      [
        "this repository's attached -R in a batch",
        `echo "-Racme-labs/demo 5 -Racme-blue/app 6" | xargs -n2 gh pr merge -R acme-blue/app`,
      ],
      [
        "this repository's URL in a batch by size",
        `echo "5 ${OURS} 6" | xargs -s 60 gh pr merge -R acme-blue/app`,
      ],
      [
        "an org's URL beside its -R in a batch",
        `echo "-R acme-blue/app 5 ${THEIRS}" | xargs -n3 gh pr merge -R acme-blue/app`,
      ],
      [
        "an unread input after pr alone through run-slot",
        "cat list | xargs run-slot.sh who -- gh pr -R acme-blue/app",
      ],
      ...SLOT_WRAPPERS.map((w): [string, string] => [
        `an unread input after pr alone through run-slot's ${w}`,
        `cat list | xargs run-slot.sh who -- ${w} gh pr -R acme-blue/app`,
      ]),
      [
        "a grep for gh through run-slot's env",
        "cat list | xargs run-slot.sh who -- env grep -l gh",
      ],
      ...GH_VALUES.flatMap((v): [string, string][] => [
        [
          `an unread input after pr alone through run-slot's ${v}`,
          `cat list | xargs run-slot.sh who -- ${v} gh pr -R acme-blue/app`,
        ],
        [
          `a grep for gh through run-slot's ${v}`,
          `cat list | xargs run-slot.sh who -- ${v} grep -l gh`,
        ],
      ]),
      [
        "an unread input after pr alone through a run-slot whose who is gh",
        "cat list | xargs run-slot.sh gh -- gh pr -R acme-blue/app",
      ],
      [
        "a grep for gh through a run-slot whose who is gh",
        "cat list | xargs run-slot.sh gh -- grep -l gh",
      ],
      [
        "this repository's merge through a run-slot whose who is gh",
        `run-slot.sh gh -- gh pr merge ${OURS}`,
      ],
      [
        "an org merge through a run-slot whose who is gh",
        `run-slot.sh gh -- gh pr merge ${THEIRS}`,
      ],
      [
        "this repository's merge through run-slot's env -u gh",
        `run-slot.sh who -- env -u gh gh pr merge ${OURS} -R acme-blue/app`,
      ],
      [
        "an org merge through run-slot's env -u gh",
        `run-slot.sh who -- env -u gh gh pr merge ${THEIRS} -R acme-blue/app`,
      ],
      [
        "this repository's URL appended through run-slot's env -u gh",
        `echo ${OURS} | xargs run-slot.sh who -- env -u gh gh pr merge -R acme-blue/app`,
      ],
      [
        "an org URL appended through run-slot's env -u gh",
        `echo ${THEIRS} | xargs run-slot.sh who -- env -u gh gh pr merge -R acme-blue/app`,
      ],
      ["a grep for gh over an unread list", "cat list | xargs grep -l gh"],
      ["a grep for gh after its --", "cat list | xargs grep -- gh"],
      ["an rg for gh after its --", "cat list | xargs rg -e x -- gh"],
      ["a grep for gh over the tracked files", "git ls-files | xargs grep -l gh"],
      ["an rg for gh over an unread list", "cat list | xargs rg gh"],
      ["a wc naming gh over an unread list", "cat list | xargs wc -l gh"],
      ["a grep for gh in place of -I's string", "cat list | xargs -I{} grep gh {}"],
      ["gh's version under an unread input", "cat list | xargs gh --version"],
      ["gh's help under an unread input", "cat list | xargs gh --help"],
      ["a view given this repository's -R", `echo "-R acme-labs/demo 5" | xargs gh pr view`],
      ["a view of this repository's URL", `echo ${OURS} | xargs gh pr view -R acme-blue/app`],
    ],
  },
]

// An org's pull request fed through xargs runs, and so does a view.
export const allowed = [
  "an org URL appended past -R",
  "an org URL appended past --repo",
  "an org URL appended past gh's own -R",
  "an org URL one item at a time",
  "an org number appended",
  "an org URL split at nul",
  "an org URL quoted to echo",
  "an org named by an appended -R",
  "an org URL in place of -I's string",
  "an org URL appended past a -J string no word is",
  "a view of this repository's URL",
  "an org merge given to pr alone",
  "an org merge given to gh alone",
  "an unread input to a typed view",
  "an org's -R in a batch",
  "an org's --repo in a batch",
  "an org's URL beside its -R in a batch",
  "a grep for gh over an unread list",
  "a grep for gh through run-slot's env",
  ...GH_VALUES.map((v) => `a grep for gh through run-slot's ${v}`),
  "a grep for gh through a run-slot whose who is gh",
  "an org merge through a run-slot whose who is gh",
  "an org merge through run-slot's env -u gh",
  "an org URL appended through run-slot's env -u gh",
  "a grep for gh after its --",
  "an rg for gh after its --",
  "a grep for gh over the tracked files",
  "an rg for gh over an unread list",
  "a wc naming gh over an unread list",
  "a grep for gh in place of -I's string",
  "gh's version under an unread input",
  "gh's help under an unread input",
  "a view given this repository's -R",
]
