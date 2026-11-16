import { describe, expect, test } from "bun:test"

import { orgOf } from "../../../../packages/config/src/org"

describe("orgOf", () => {
  test("with nothing set, every value is a generic default, and no integration is read", () => {
    expect(orgOf({})).toEqual({
      cluster: { key: undefined, peers: [] },
      owner: { name: "Owner" },
      work: { label: "Work", org: undefined },
    })
  })

  test("a full config reads every key", () => {
    expect(
      orgOf({
        PLAYGROUND_OWNER_NAME: "Merritt",
        PLAYGROUND_PEER_KEY: "/home/you/.ssh/cluster",
        PLAYGROUND_PEERS: "machine-b=you@10.0.0.2",
        WORK_GITHUB_ORG: "example",
        WORK_LABEL: "Day job",
      }),
    ).toEqual({
      cluster: {
        key: "/home/you/.ssh/cluster",
        peers: [{ name: "machine-b", target: "you@10.0.0.2" }],
      },
      owner: { name: "Merritt" },
      work: { label: "Day job", org: "example" },
    })
  })

  test("an empty value reads as unset", () => {
    expect(
      orgOf({
        PLAYGROUND_OWNER_NAME: "",
        WORK_GITHUB_ORG: "",
      }),
    ).toMatchObject({
      owner: { name: "Owner" },
      work: { org: undefined },
    })
  })

  test("peers are a comma list of name=user@host, each read in its order, spaces around an entry dropped", () => {
    expect(
      orgOf({ PLAYGROUND_PEERS: "machine-b=you@10.0.0.2, machine-c=me@machine-c" }).cluster.peers,
    ).toEqual([
      { name: "machine-b", target: "you@10.0.0.2" },
      { name: "machine-c", target: "me@machine-c" },
    ])
  })

  test("a peer that could become an ssh flag or a second argument, or has no name, is refused, and so is a key that is not an absolute path", () => {
    for (const peers of [
      "machine-b=-oProxyCommand=x@h",
      "machine-b=you@-h",
      "machine-b=you @h",
      "you@10.0.0.2",
      "-b=you@h",
      "machine-b=host",
    ]) {
      expect(() => orgOf({ PLAYGROUND_PEERS: peers })).toThrow()
    }
    expect(() => orgOf({ PLAYGROUND_PEER_KEY: "~/.ssh/cluster" })).toThrow()
  })

  test("a work org that is not a GitHub login is refused, so it adds nothing to the search", () => {
    expect(() => orgOf({ WORK_GITHUB_ORG: "example is:closed" })).toThrow()
  })
})
