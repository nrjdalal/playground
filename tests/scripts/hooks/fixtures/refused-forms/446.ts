import { type Group } from "./_shared"

// The forms the review of this file's source found refused; rows are data, as refused-forms.ts says.
export const groups: Group[] = [
  {
    folders: ["checkout"],
    guards: ["no-desktop-owner-app"],
    rows: () => [
      ["agent-desktop naming a listed app", "agent-desktop snapshot --app Slack"],
      ["bunx agent-desktop naming a listed app", "bunx agent-desktop snapshot --app Slack"],
      ["npx agent-desktop naming a listed app", "npx -y agent-desktop snapshot --app Slack"],
      ["sh -c agent-desktop naming a listed app", "sh -c 'agent-desktop snapshot --app Slack'"],
      [
        "bun -e spawning it as a program word",
        `bun -e 'Bun.spawn(["agent-desktop", "snapshot", "--app", "Finder"])'`,
      ],
      [
        "bun -e spawning it by its path",
        `bun -e 'Bun.spawn(["/opt/homebrew/bin/agent-desktop", "launch", "Slack"])'`,
      ],
      [
        "deno eval spawning it",
        `deno eval 'new Deno.Command("agent-desktop", { args: ["snapshot"] }).spawn()'`,
      ],
      [
        "node -e running it as a shell line",
        `node -e 'require("child_process").execSync("agent-desktop snapshot --app Finder")'`,
      ],
      [
        "node -e running it after && in a shell line",
        `node -e 'require("child_process").execSync("open -a Finder && agent-desktop snapshot --app Finder")'`,
      ],
      [
        "node -e running it behind xargs in a shell line",
        `node -e 'require("child_process").execSync("echo x | xargs agent-desktop snapshot")'`,
      ],
      [
        "node -e running it behind timeout in a shell line",
        `node -e 'require("child_process").execSync("timeout 5 agent-desktop snapshot --app Finder")'`,
      ],
      [
        "node -e running it behind NPX in capitals",
        `node -e 'require("child_process").execSync("NPX agent-desktop snapshot --app Finder")'`,
      ],
      [
        "node -e running it after a newline escape",
        `node -e 'require("child_process").execSync("echo hi\\nagent-desktop snapshot --app Finder")'`,
      ],
      [
        "node -e evaluating code that spawns it",
        `node -e 'eval("require(\\"child_process\\").execSync(\\"agent-desktop snapshot\\")")'`,
      ],
      ...(["watch", "flock /tmp/x", "setsid"] as const).map(
        (wrapper) =>
          [
            `node -e running it behind ${wrapper.split(" ")[0]} in a shell line`,
            `node -e 'require("child_process").execSync("${wrapper} agent-desktop snapshot --app Finder")'`,
          ] as const,
      ),
      [
        "node -e sourcing a file named for it in a shell line",
        `node -e 'require("child_process").execSync("source agent-desktop")'`,
      ],
      [
        "node -e running a script by its path beside it in a shell line",
        `node -e 'require("child_process").execSync("bin/run agent-desktop")'`,
      ],
      [
        "ruby a double-quote char literal that opens no string around spawning code",
        `ruby -e 'c = ?" and system *%w[x agent-desktop snapshot --app Slack][1..4] and ?"'`,
      ],
      [
        "ruby a single-quote char literal that opens no string around spawning code",
        `ruby -e "c = ?' and system *%w[x agent-desktop snapshot --app Slack][1..4] and ?'"`,
      ],
      [
        "ruby a %w word list slice with no quote",
        `ruby -e 'system *%w[x agent-desktop snapshot --app Slack][1..4]'`,
      ],
      [
        "perl a quote inside m[] and qw[] delimiters that opens no string",
        `perl -e '$c = m["] or @a = qw[x agent-desktop snapshot --app Slack] and shift @a and system @a and m["]'`,
      ],
      [
        "bun building the program name from a string then spawning it",
        `bun -e 'Bun.spawn(["run agent-desktop".split(" ")[1], "snapshot", "--app", "Slack"])'`,
      ],
      [
        "node running it in a backtick template",
        `node -e 'require("child_process").execSync(\`agent-desktop snapshot --app Slack\`)'`,
      ],
      [
        "python3 running it in a triple-quoted string",
        `python3 -c 'import os; os.system("""agent-desktop snapshot --app Slack""")'`,
      ],
      [
        "bun -e running it in a template",
        "bun -e 'await Bun.$`agent-desktop snapshot --app Finder`'",
      ],
      [
        "python3 -c spawning it as an argument of npx",
        `python3 -c "import subprocess; subprocess.run(['npx', 'agent-desktop', 'snapshot'])"`,
      ],
      [
        "python3 -c running it behind npx -y",
        `python3 -c "import os; os.system('npx -y agent-desktop snapshot --app Finder')"`,
      ],
      [
        "python3 -c running it behind npx",
        `python3 -c "import os; os.system('npx agent-desktop snapshot --app Finder')"`,
      ],
      [
        "python3 -c running it from an f-string",
        `python3 -c "import os; os.system(f'{chr(32)}agent-desktop snapshot')"`,
      ],
      ["python3 handing it to a script as an argument", "python3 run.py agent-desktop snapshot"],
      [
        "ruby -e running it behind sudo in sh -c",
        `ruby -e 'system("sh", "-c", "sudo agent-desktop snapshot --app Finder")'`,
      ],
      ["ruby -e running it in %x()", "ruby -e 'puts %x(agent-desktop snapshot --app Finder)'"],
      ["perl -e spawning it from qw()", "perl -e 'system qw(agent-desktop snapshot --app Finder)'"],
      [
        "osascript running it as a shell script",
        `osascript -e 'do shell script "agent-desktop snapshot --app Finder"'`,
      ],
      [
        "bun -e writing a JSON label whose prose names it",
        `cd /x/.claude/worktrees/y && bun -e 'const f="items.json";const a=await Bun.file(f).json();a.push({label:"Owner at the screen (about 00:15Z): Ops runs the ! list (desktop-owner-apps, #400 companies, agent-desktop grants), then checks Finder, Helium and coverage",eta:"2026-11-02T01:00:00Z",done:false});await Bun.write(f,JSON.stringify(a,null,2)+"\\n");console.log("ok")'`,
      ],
      [
        "bun -e editing a JSON label whose prose names it, then a script",
        `cd /x/.claude/worktrees/y && bun -e 'const f="items.json";const a=await Bun.file(f).json();const x=a.find(x=>!x.done&&x.label.startsWith("Owner at the screen"));x.label="Waits on the owner: agent-desktop helper grant (Accessibility, Screen Recording), then Ops re-probes; #400 companies on his yes (desktop-owner-apps done 23:23Z)";delete x.eta;await Bun.write(f,JSON.stringify(a,null,2)+"\\n");console.log("ok")' && bun health.ts > beat-body.txt`,
      ],
      [
        "python3 -c printing prose that names it",
        `python3 -c "print('The guard reads agent-desktop calls, then the list.')"`,
      ],
    ],
  },
]

export const allowed: string[] = [
  "bun -e writing a JSON label whose prose names it",
  "bun -e editing a JSON label whose prose names it, then a script",
  "python3 -c printing prose that names it",
]
