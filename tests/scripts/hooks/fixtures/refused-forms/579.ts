import { type Group, NEVER_MADE } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-raw-delete"],
    rows: () => [
      ["del-cli through npx", `npx del-cli ${NEVER_MADE}`],
      ["del-cli with a version through npx", `npx -y del-cli@5 ${NEVER_MADE}`],
      ["del-cli through bunx", `bunx del-cli ${NEVER_MADE}`],
      ["del-cli through pnpm dlx", `pnpm dlx del-cli ${NEVER_MADE}`],
      ["del-cli through pnpx", `pnpx del-cli ${NEVER_MADE}`],
      ["del-cli's del bin through npx", `npx del ${NEVER_MADE}`],
      ["del-cli run by its own name", `del-cli ${NEVER_MADE}`],
      ["del-cli's del bin run by its path", `./node_modules/.bin/del ${NEVER_MADE}`],
      [
        "rsync's source-removal option",
        `rsync -a --remove-source-files ${NEVER_MADE}/ /var/empty/x/`,
      ],
      [
        "rsync's old source-removal alias",
        `rsync -a --remove-sent-files ${NEVER_MADE}/ /var/empty/x/`,
      ],
      ["fd's -X behind another short flag, then rm", `fd . ${NEVER_MADE} -HX rm`],
      ["fd's -x behind another short flag, then rm", `fd . ${NEVER_MADE} -Hx rm`],
      ["fd's clustered -x with rm attached", `fd . ${NEVER_MADE} -HIxrm`],
      ["fd's clustered -x with =rm attached", `fd . ${NEVER_MADE} -Hx=rm`],
      ["at fed a job from a variable's file", `at now < "$F"`],
      ["at fed a job from an unquoted variable's file", `at now < $F`],
      ["at given -f a variable's file", `at -f "$F" now`],
      ["at fed a variable's file inside bash -c's double quotes", `bash -c "at now < $F"`],
      ["at fed a program's output, which the hook cannot read", "ls | at now"],
      ["a variable holding a recursive delete, run unquoted", `c="rm -rf ${NEVER_MADE}"; $c`],
      [
        "an exported variable holding a recursive delete, run unquoted",
        `export c="rm -rf ${NEVER_MADE}"; $c`,
      ],
      ["a variable holding a recursive delete, run as ${c}", `c="rm -rf ${NEVER_MADE}"; \${c}`],
      [
        "a variable holding a recursive delete, run unquoted under bash",
        `bash -c 'c="rm -rf ${NEVER_MADE}"; $c'`,
      ],
      ["shred -u", `shred -u ${NEVER_MADE}/x`],
      ["shred -u in a cluster", `shred -zu ${NEVER_MADE}/x`],
      ["shred --remove", `shred --remove ${NEVER_MADE}/x`],
      ["shred --remove with a value", `shred --remove=wipe ${NEVER_MADE}/x`],
      ["shred by a prefix of --remove", `shred --rem ${NEVER_MADE}/x`],
      ["GNU shred's Homebrew name with -u", `gshred -u ${NEVER_MADE}/x`],
      ["tar --remove-files", `tar -cf /var/empty/a.tar --remove-files ${NEVER_MADE}`],
      ["tar by a prefix of --remove-files", `tar --remove-f -cf /var/empty/a.tar ${NEVER_MADE}`],
      [
        "GNU tar's Homebrew name with --remove-files",
        `gtar -cf /var/empty/a.tar --remove-files ${NEVER_MADE}`,
      ],
    ],
  },
]
