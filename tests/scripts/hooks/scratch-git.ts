// git in a test's scratch folder, kept apart from refused-forms.test.ts so a file that imports the fixture names no way to run a command (fixtures-are-data.test.ts).
export const git = (dir: string, ...args: string[]) =>
  Bun.spawnSync([
    "git",
    "-C",
    dir,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "-c",
    "commit.gpgsign=false",
    ...args,
  ])
