import type { Group } from "./_shared"

// #3145: a gh api call xargs gives words from its input is judged with them, so an input that gives this repository's (acme-labs/demo here, the checkout's origin) merge or ref endpoint and a write method is refused, readable or not; an input the hook cannot read is refused where it may give the endpoint, or a method past a typed GET to a merge or ref endpoint here, since xargs appends after the typed -X and gh takes the last; each twin, a read of another endpoint, an org's endpoint (acme-blue/app) or -I's one argument, runs. Rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-protected-push"],
    rows: () => [
      ["an unread input to gh api with no endpoint", "cat list | xargs gh api"],
      ["an unread input to api past gh's own -R", "cat list | xargs gh -R acme-blue/app api"],
      ["an unread input to gh api through mise exec", "cat list | xargs mise exec -- gh api"],
      ["an unread input to gh api past a GET alone", "cat list | xargs gh api --method GET"],
      [
        "an unread input past a GET to this repository's merge endpoint",
        "cat list | xargs gh api -X GET repos/acme-labs/demo/pulls/5/merge",
      ],
      [
        "an unread input past a GET to this repository's canary ref",
        "cat list | xargs gh api -X GET repos/acme-labs/demo/git/refs/heads/canary",
      ],
      [
        "a PUT to this repository's merge endpoint from the input",
        "echo repos/acme-labs/demo/pulls/5/merge -X PUT | xargs gh api",
      ],
      [
        "an api merge of this repository given to gh alone",
        "echo api -X PUT repos/acme-labs/demo/pulls/5/merge | xargs gh",
      ],
      [
        "an unread input past a GET to this repository's pull request",
        "cat list | xargs gh api -X GET repos/acme-labs/demo/pulls/5",
      ],
      [
        "an unread input past a GET to this repository's pull requests",
        "cat list | xargs gh api -X GET repos/acme-labs/demo/pulls",
      ],
      [
        "an unread input to an org's merge endpoint",
        "cat list | xargs gh api repos/acme-blue/app/pulls/5/merge",
      ],
      [
        "a PUT to an org's merge endpoint from the input",
        "echo repos/acme-blue/app/pulls/5/merge -X PUT | xargs gh api",
      ],
      [
        "an api merge of an org given to gh alone",
        "echo api -X PUT repos/acme-blue/app/pulls/5/merge | xargs gh",
      ],
      [
        "a read of this repository's pull requests from the input",
        "echo repos/acme-labs/demo/pulls -X GET | xargs gh api",
      ],
      ["an unread input in place of -I's endpoint", "cat list | xargs -I{} gh api {}"],
      [
        "an unread input in place of -I's string in this repository's endpoint",
        "cat list | xargs -I{} gh api repos/acme-labs/demo/{}",
      ],
    ],
  },
]

// A read, an org's endpoint and -I's one argument, which gh api sends as a GET, run.
export const allowed = [
  "an unread input past a GET to this repository's pull request",
  "an unread input past a GET to this repository's pull requests",
  "an unread input to an org's merge endpoint",
  "a PUT to an org's merge endpoint from the input",
  "an api merge of an org given to gh alone",
  "a read of this repository's pull requests from the input",
  "an unread input in place of -I's endpoint",
  "an unread input in place of -I's string in this repository's endpoint",
]
