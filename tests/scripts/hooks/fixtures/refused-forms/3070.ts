import { type Group, NEVER_MADE, type Row } from "./_shared"

// #3070 and #2990: text a program only reads or prints is content, judged for naming the root alone: an awk program whose strings sit beside a regex's alternation, a perl block that prints a match, a sed replacement between | delimiters, an echo or printf behind builtin or command, and an ln -s's source on a line nothing else can write through its link, while each one that writes, runs a command or names the root in what it writes is still refused; rows are data, as refused-forms.ts says.
const EXT = "~/.playground/extensions"

const held = (): Row[] => [
  ["an awk that writes into the root", `awk '{print > "${EXT}/x"}' run.log`],
  [
    "an awk beside an alternation that writes into the root",
    `awk '/a|b/ {print "y" > "${EXT}/x"}' run.log`,
  ],
  ["an awk that runs a remover in the root", `awk 'BEGIN {system("rm -rf ${NEVER_MADE}")}'`],
  [
    "an awk that pipes into a command naming the root",
    `awk '/a|b/ {print "x" | "touch ${EXT}/x"}' run.log`,
  ],
  [
    "an awk that prints a line naming the root into a file",
    `awk 'BEGIN {print "touch ${EXT}/x"}' > run.sh`,
  ],
  ["a perl edit in place of a file in the root", `perl -i -pe 's/a/b/' ${EXT}/home/items.json`],
  [
    "a perl block that prints a line naming the root",
    `perl -ne 'if (/a/) {print "touch ${EXT}/x"}' notes.md`,
  ],
  ["a perl block that runs a command", `perl -ne 'while (/(a)/g) {print; system("x")}' notes.md`],
  ["a perl block whose regex runs code", `perl -ne 'while (/(?{system("x")})/) {print}' notes.md`],
  ["a perl block with -i on a file in the root", `perl -i -ne 'while (/a/) {print}' ${EXT}/home/x`],
  ["a sed edit in place of a file in the root", `sed -i '' 's/a/b/' ${EXT}/home/items.json`],
  ["a sed edit between bars of a file in the root", `sed -i '' 's|a|b|' ${EXT}/home/x`],
  [
    "a sed replacement between bars that names the root",
    `sed -i '' 's|old|rm -f ${EXT}/home/x|' body.md`,
  ],
  ["a sed between bars whose w flag writes into the root", `sed -i '' 's|a|b|w ${EXT}/x' body.md`],
  [
    "a sed edit between bars of a file the hook does not hold",
    `sed -i '' 's|old|rm -f "$S/x"|' "$S/body.md"`,
  ],
  ["an ln -s whose link is in the root", `ln -s /tmp/x ${EXT}/home/x`],
  [
    "an ln -s from the root and a write through its link",
    `ln -s ${EXT}/home/x s/x && echo y > s/x`,
  ],
  ["an ln -s from the root and a copy through its link", `ln -s ${EXT}/home/x s/x && cp f s/x/y`],
  ["an ln -s from the root and a move through its link", `ln -s ${EXT}/home/x s/x && mv f s/x`],
  [
    "an ln -s from the root and a sed edit through its link",
    `ln -s ${EXT}/home/x s/x; sed -i '' 's/a/b/' s/x`,
  ],
  ["an ln -s from the root and a tee through its link", `ln -s ${EXT}/home/x s/x | tee s/x/y`],
  [
    "an ln -s from the root and a shell that writes through its link",
    `ln -s ${EXT}/home s/h; bash -c 'echo y > s/h/z'`,
  ],
  [
    "an ln -s from the root beside a program the hook cannot read",
    `ln -s ${EXT}/home/x s/x; python3 -c 'print(1)'`,
  ],
  [
    "an ln -s from the root beside a substitution that writes",
    `ln -s ${EXT}/home/x s/x; echo $(touch y)`,
  ],
  ["an ln -s from the root with a redirect", `ln -s ${EXT}/home/x s/x > /tmp/log`],
  [
    "an ln -s from the root with one operand, which links into the shell's folder",
    `ln -s ${EXT}/home/x`,
  ],
  ["an ln -s from the root into a -t folder", `ln -s -t s ${EXT}/home/x`],
  ["a hard ln from the root, which shares the file", `ln ${EXT}/home/x s/x`],
  ["an ln -s with a variable set in the call", `X=1 ln -s ${EXT}/home/x s/x`],
  ["an ln -s from the root to a link the hook does not hold", `ln -s ${EXT}/home/x "$S/x"`],
  ["an echo behind builtin piped into a shell", `builtin echo 'touch ${EXT}/x' | sh`],
  [
    "an echo behind builtin whose substitution runs a write",
    `builtin echo "$(touch ${EXT}/x)" > notes.md`,
  ],
  ["an eval behind builtin", `builtin eval 'touch ${EXT}/x'`],
  ["a shell behind command", `command bash -c 'touch ${EXT}/x'`],
  [
    "a printf -v behind command whose value an eval runs",
    `command printf -v X '%s' 'touch ${EXT}/x'; eval "$X"`,
  ],
]

// A redirect's ~ expands to the process's own home, so a redirect into the root is held in the process worktree alone
const redirects = (): Row[] => [
  ["a sed between bars whose output is written into the root", `sed 's|a|b|' body.md > ${EXT}/x`],
  ["an echo behind builtin written into the root", `builtin echo hi > ${EXT}/home/x`],
  ["an echo behind command appended into the root", `command echo hi >> ${EXT}/home/x`],
]

// Pass controls: each reads or prints alone, or writes only outside the root.
const controls = (): Row[] => [
  [
    "an awk whose strings sit beside a regex's alternation",
    `awk '/\\(pass\\)|\\(fail\\)/ {print $1" "$2}' run.log`,
  ],
  [
    "an awk after grep whose strings sit beside an escaped alternation",
    `grep -E 'x' run.log | awk '/\\(pass\\)\\|\\(fail\\)/ {n++} END {print n" lines"}'`,
  ],
  ["an awk whose string holds a bar", `awk '/a|b/ {print "a|b"}' run.log`],
  [
    "an awk that edits a variable with gsub and sub",
    `awk '{v=$0; gsub(/[\\[\\]]/,"",v); if (v ~ /ms$/) {sub(/ms/,"",v); t+=v/1000} else {sub(/s/,"",v); t+=v}} END {printf "%.1fs over %d\\n", t, NR}' run.log`,
  ],
  [
    "a perl while block that prints each match",
    `perl -ne 'while (/(ab+c)/gi) {print "$1\\n"}' notes.md`,
  ],
  ["a perl if block that prints a match", `perl -ne 'if (/^x (\\d+)/) { print "$1\\n" }' notes.md`],
  [
    "a sed edit between bars whose replacement holds a remover of a variable",
    `sed -i '' 's|old line|rm -f "$S/prebuild.pid"|' body.md`,
  ],
  [
    "a sed read between bars whose replacement holds a remover of a variable",
    `sed 's|old line|rm -f "$S/prebuild.pid"|' body.md`,
  ],
  ["a sed edit between bars by -e", `sed -i '' -e 's|old|cp "$A" "$B"|' body.md`],
  ["an ln -s from the root to a link outside it", `ln -s ${EXT}/home/skills/x scratch/x`],
  [
    "an ln -sf from the root and a listing",
    `ln -sf ${EXT}/home/skills/x scratch/x && ls -la scratch`,
  ],
  [
    "an ln -sfn from the root and a cat through its link",
    `ln -sfn ${EXT}/home/skills/x scratch/x && cat scratch/x/SKILL.md`,
  ],
  [
    "an echo behind builtin of a line naming the root into a file",
    `builtin echo 'touch ${EXT}/x' > notes.md`,
  ],
  [
    "an echo behind command of a line naming the root into a file",
    `command echo 'touch ${EXT}/x' > notes.md`,
  ],
  [
    "a printf behind command of a line naming the root into a file",
    `command printf '%s\\n' 'rm -rf ${NEVER_MADE}' > notes.md`,
  ],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
  { folders: ["process worktree"], guards: ["no-extensions-write"], rows: redirects },
]

export const allowed: string[] = controls().map(([what]) => what)
