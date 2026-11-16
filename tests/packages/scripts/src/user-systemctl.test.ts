import { expect, test } from "bun:test"

import { userSystemctl } from "../../../../packages/scripts/src/user-systemctl"

const bus = (path: string) => path === "/run/user/1000/bus"

test("with XDG_RUNTIME_DIR unset and the user's bus there, systemctl --user runs with it set to that folder", () => {
  expect(userSystemctl(["enable", "--now", "a.service"], {}, 1000, bus)).toEqual([
    "env",
    "XDG_RUNTIME_DIR=/run/user/1000",
    "systemctl",
    "--user",
    "enable",
    "--now",
    "a.service",
  ])
})

test("a set XDG_RUNTIME_DIR, or no bus in the user's folder, leaves the plain call", () => {
  expect(
    userSystemctl(["daemon-reload"], { XDG_RUNTIME_DIR: "/run/user/1000" }, 1000, bus),
  ).toEqual(["systemctl", "--user", "daemon-reload"])
  expect(userSystemctl(["daemon-reload"], {}, 1001, bus)).toEqual([
    "systemctl",
    "--user",
    "daemon-reload",
  ])
})
