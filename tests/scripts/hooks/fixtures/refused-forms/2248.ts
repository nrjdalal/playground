import type { Group, Row } from "./_shared"

// #2248: the data folder written into a git hook by an in-place perl's print text, by a perl or GNU sed replacement that spells the slash by a hex, octal or decimal escape, or by a printer's or a read-only sed's or perl's output that a redirect or a tee writes into the hook, each judged the same from every working folder; rows are data, as refused-forms.ts says.
const held = (): Row[] => [
  [
    "an in-place perl -pi whose print writes a glob of the data folder into a git hook",
    `perl -pi -e 'print "touch ~/.play*/extensions/x\\n"' .git/hooks/pre-commit`,
  ],
  [
    "an in-place perl -ni whose print writes a glob of the data folder into a git hook",
    `perl -ni -e 'print "touch ~/.play*/extensions/x"' .git/hooks/pre-commit`,
  ],
  [
    "an in-place perl whose print writes a glob of the data folder after a match variable",
    `perl -pi -e 'print "$1 ~/.play*/extensions/x" if /(a)/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place perl whose s/// spells the slash by a hex escape",
    String.raw`perl -pi -e 's/a/touch ~\x2f.playground\x2fextensions\x2fx/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place perl whose s/// spells the slash by a braced hex escape",
    String.raw`perl -pi -e 's/a/touch ~\x{2f}.playground\x{2f}extensions\x{2f}x/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place perl whose s/// spells the slash by an octal escape",
    String.raw`perl -pi -e 's/a/touch ~\057.playground\057extensions\057x/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place perl whose s/// spells the slash by a braced octal escape",
    String.raw`perl -pi -e 's/a/touch ~\o{57}.playground\o{57}extensions\o{57}x/' .git/hooks/pre-commit`,
  ],
  [
    "a read-only perl whose s/// spells the slash by a hex escape, redirected into a git hook",
    String.raw`perl -pe 's/a/touch ~\x2f.playground\x2fextensions\x2fx/' run.sh > .git/hooks/pre-commit`,
  ],
  [
    "a read-only GNU sed whose s/// spells the slash by a hex escape, redirected into a git hook",
    String.raw`gsed 's/a/touch ~\x2f.playground\x2fextensions\x2fx/' run.sh > .git/hooks/pre-commit`,
  ],
  [
    "an in-place GNU sed whose s/// spells the slash by an octal escape",
    String.raw`gsed -i 's/a/touch ~\o57.playground\o57extensions\o57x/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place GNU sed whose s/// spells the slash by a decimal escape",
    String.raw`gsed -i 's/a/touch ~\d47.playground\d47extensions\d47x/' .git/hooks/pre-commit`,
  ],
  [
    "a read-only sed -n whose output holds a glob of the data folder, piped into a git hook by tee",
    `sed -n 's#a#touch ~/.play*/extensions/x#p' run.sh | tee .git/hooks/pre-commit`,
  ],
  [
    "a read-only perl whose print holds a glob of the data folder, redirected into a git hook",
    `perl -ne 'print "touch ~/.play*/extensions/x\\n"' run.sh > .git/hooks/pre-commit`,
  ],
  [
    "an echo of the quoted data folder redirected into a git hook",
    `echo 'touch ~/.playground/extensions/x' > .git/hooks/pre-commit`,
  ],
  [
    "an echo of a quoted glob of the data folder appended to a git hook",
    `echo 'touch ~/.play*/extensions/x' >> .git/hooks/pre-commit`,
  ],
  [
    "an echo of the quoted data folder piped into a git hook by tee",
    `echo 'touch ~/.playground/extensions/x' | tee -a .git/hooks/pre-commit`,
  ],
  [
    "a printf of a quoted glob of the data folder redirected into a git hook",
    String.raw`printf 'touch ~/.play*/extensions/x\n' > .git/hooks/pre-commit`,
  ],
]
// controls that keep canary's verdict: text with no path, a path outside the data folder, and the data folder written into a file no shell runs as a hook
const controls = (): Row[] => [
  [
    "an in-place perl whose print writes a header line with no path",
    String.raw`perl -pi -e 'print "// header\n" if /^import/' src/a.ts`,
  ],
  [
    "an in-place perl whose print writes a plain word into a git hook",
    `perl -pi -e 'print "set -e\\n" if /^#!/' .git/hooks/pre-commit`,
  ],
  [
    "an in-place perl whose s/// writes plain escaped slashes",
    String.raw`perl -pi -e 's/\/usr\/local/\/opt/' Makefile`,
  ],
  [
    "an in-place perl whose s/// writes a folder outside the home by a hex escape into a git hook",
    String.raw`perl -pi -e 's/a/cd \x2fopt\x2fx/' .git/hooks/pre-commit`,
  ],
  [
    "a read-only GNU sed whose s/// writes /tmp by a hex escape",
    String.raw`gsed 's/a/\x2ftmp/' a.txt`,
  ],
  [
    "a read-only sed whose s/// writes /var/tmp by escaped slashes",
    String.raw`sed 's/\/tmp\//\/var\/tmp\//g' a.txt`,
  ],
  [
    "a read-only sed -n that prints each path's last part",
    String.raw`sed -n 's/^.*\/\(.*\)$/\1/p' paths.txt`,
  ],
  [
    "a read-only sed -n whose output names another folder of the home, piped into a git hook by tee",
    `sed -n 's#a#touch ~/.config/x#p' run.sh | tee .git/hooks/pre-commit`,
  ],
  [
    "an echo of another folder of the home redirected into a git hook",
    `echo 'touch ~/.config/x' > .git/hooks/pre-commit`,
  ],
  [
    "an echo of a plain command redirected into a git hook",
    `echo 'bun test' > .git/hooks/pre-commit`,
  ],
  [
    "an echo of the quoted data folder redirected into a note",
    `echo 'touch ~/.playground/extensions/x' > notes.md`,
  ],
]

const rows = () => [...held(), ...controls()]

export const groups: Group[] = [
  { folders: ["data folder", "home", "process worktree"], guards: ["no-extensions-write"], rows },
]

export const allowed: string[] = controls().map(([what]) => what)
