// The installed `claude`, found on PATH with cmux's shims left out: a shim runs cmux's wrapper, which adds its own session id and settings to the call and ties it to the terminal that started it.
export const claudeBinary = (path = process.env.PATH ?? ""): string | null =>
  Bun.which("claude", {
    PATH: path
      .split(":")
      .filter((dir) => !dir.includes("/cmux-cli-shims"))
      .join(":"),
  })
