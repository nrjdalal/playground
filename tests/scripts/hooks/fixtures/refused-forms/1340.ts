import { type Group } from "./_shared"

// #1340: after a cd to a folder the hook cannot read, a program on neither REMOVERS nor WRITERS that writes its operands, an output option's value, or the shell's own folder may write into the extensions root; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout", "home"],
    guards: ["no-extensions-write"],
    rows: () => [
      ["an in-place sed after a cd to a variable", `cd "$X"; sed -i '' s/a/b/ policy.json`],
      ["an in-place perl after a cd to a variable", `cd "$X"; perl -pi -e s/a/b/ policy.json`],
      ["chmod after a cd to a variable", `cd "$X"; chmod 644 policy.json`],
      ["truncate after a cd to a variable", `cd "$X"; truncate -s 0 policy.json`],
      ["shred after a cd to a variable", `cd "$X"; shred -u policy.json`],
      ["tar extracting after a cd to a variable", `cd "$X"; tar -xf /tmp/a.tar`],
      ["curl's -o after a cd to a variable", `cd "$X"; curl -o policy.json https://example.com`],
      ["sort's -o after a cd to a variable", `cd "$X"; sort -o policy.json /tmp/a`],
      ["git rm after a cd to a variable", `cd "$X"; git rm -q policy.json`],
      ["mktemp of a template after a cd to a variable", `cd "$X"; mktemp policy.XXXX`],
      ["chmod under xargs after a cd to a variable", `cd "$X"; xargs chmod 644 policy.json`],
    ],
  },
]
