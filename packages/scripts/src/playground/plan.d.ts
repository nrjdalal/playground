export type Backend = "claude" | "glm";
export type Dispatcher = {
    backend: Backend | null;
    name: string;
};
export type Probes = {
    api: boolean;
    dispatchers: Dispatcher[];
    follower: boolean;
    glm: boolean;
    terminal: boolean;
    web: boolean;
};
export type Step = "dispatcher" | "jobs" | "open" | "wait";
export declare const NEW_WORKER_BRIEF = "handoffs/new-worker.md";
export declare const VIEW_SERVER = "playground";
export declare const HELP = "playground            start herdr's servers that are down and restore their sessions, start the Dashboard's stack and follower when down (in cmux while a session is open there, else in herdr), start the dispatcher when it is not running (playground dispatcher), stop there when the Dashboard needs a cmux terminal open, else wait for the Dashboard (a progress line every 10s, stopping early once ops-dashboard's supervisor stops, 15 minutes at most), then open it; a step that failed is named last, with why, under Left for you, and the run exits 1\nplayground view       open the playground herdr server, where the sessions run, in this terminal\nplayground dispatcher start the dispatcher in a herdr workspace of its own, its brief written once from scripts/briefs/dispatcher.md into the data folder as brief-<dispatcher>.md: exit 0 started, 3 already running, 1 refused with spawn.sh's reason\nplayground planner | builder | ops | optimizer\n                      start that manager as playground dispatcher starts the dispatcher, its brief from scripts/briefs/<manager>.md; the dispatcher runs it the first time it routes work there, and the optimizer at its own start\nplayground status     one line each for the terminal, the Dashboard, the follower, each dispatcher, GLM and each herdr server\nplayground sweep <lead>\n                      what changed since that lead's last sweep (alerts, the merge queue, load5 crossing 15, the single-slot flag, its rows' passed ETAs), or quiet\nplayground page <file.html> --title \"<title>\" --by <session> [--for <session>]\n                      keep a page for the Dashboard: copy it into the previews folder under a free name, with its title as its caption and a line in pages.jsonl, and print the copy's path for an Inbox card's html attachment (bun run ask new), opening nothing; it shows on the Pages tab of --by's view, of --for's and of the dispatcher's\nplayground update [--to <tag>]\n                      fast-forward this checkout onto origin/main, re-run link-skills.sh, install when a lockfile or package.json changed, build packages/* when one with a dist changed, restart the ops jobs whose source changed, then roll the Dashboard to the newest build: Building, Switching, then Updated to <sha7> or Failed: <reason>; --to moves the checkout to that release instead, back or on, and leaves the Dashboard as it is\nplayground doctor     one line per need, as ok, MISSING with its fix, or optional: the tools, the data folder, the pinned herdr, the links into this checkout, the release it is at, and each ops job launchd should hold\nplayground herdr pin [--check | --asset <file>]\n                      put the pinned herdr's release asset for this Mac at the data folder's bin/herdr, after checking its SHA-256 against the pin, refusing a mismatch with both sums; --check reads the copy alone, exit 1 when it is missing or changed; --asset installs from a file instead of downloading\nplayground herdr stop stop every herdr server Playground started, each through its own socket in the data folder's herdr folder; every session in them ends with it, and the next playground or Start brings them back\nplayground version    this checkout's tag and sha, the extensions' last commit and Claude Code's version\nplayground ask <command> ...\n                      the Inbox: post an ask, read its answer, close it (bun run ask)\nplayground changelog <command> ...\n                      add rows to the Changelog from GitHub's merges and versions, or a line by hand (bun run changelog)\nplayground dm send <file>\n                      post the reply in <file>, named by its absolute path, to the owner's own DM in its frame, the one way any session posts there (bun run dm)\nplayground ingest [--follow | status]\n                      read every Claude Code session on this machine into the Dashboard's database (bun run ingest)\nplayground queues     print the merge queue and the work queue (bun run queues)\nplayground thread <command> ...\n                      open, route, rename or list the Inbox's threads (bun run thread)\nplayground accounts list | add --provider claude --email <email> [--label <label>] | add --provider glm --label <label> | remove <email|label>\n                      the accounts the factory spends, each a usage.accounts row with its secret in the Keychain: list each with whether its secret is kept and its last 5-hour and week reading; add a Claude account by running claude setup-token here, then pasting the token it prints, or a GLM key pasted under its label, neither echoed; remove one's row and its Keychain item\nplayground orgs resolve [--repo <dir>]\n                      write the merged skill plugin a session in <dir> loads and print its folder: each skill from the first scope that has it: ext.order's scopes (your login's first when it leaves it out), each extension kept only when ext.links links it to the repo's GitHub owner or *, then core (skills/playground, skills/zerostarter, extensions/core/skills); with no --repo, the home set\nplayground orgs home  write the home set and install it at user scope as ws-home@ws, for a session started by hand (link-skills.sh runs it)\nplayground rules [<name>]\n                      the standing rules a factory session starts with, each by its glance line, or one rule whole, with this machine's values in its slots\nplayground settings list | get <key> [--org <org>] | why <key> | set <key> <value> --reason \"<why>\" [--scope <scope>] | reset <key> --reason \"<why>\" [--scope <scope>]\n                      read or change a setting in the extensions folder, each write one commit with its reason (an org's scope or your login's, your login's by default)\nplayground settings import-jobs <jobs.json> [--launch-agents <dir>] [--scope <scope>] [--dry-run]\n                      once, at the switch: each ops job jobs.json lists becomes its jobs.<name> setting (your login's scope by default), a launchd job's program read from its plist; a job the registry does not know stays in jobs.json\nplayground ext which <skill> [--repo <dir>]\n                      print the folder of the copy of <skill> a session in <dir> loads, from whichever scope holds it\nplayground ext init [--yes | --dry-run] | add <name> [<owner/name>] [--yes] | order | link | unlink | remove | sync [<scope>] | list | show | put | why | diff | search | export <dir> | import <dir> [--dry-run] | import --from-tree <dir> | import-scripts <ops-dir> <job>... --org <org> | score | accept | reject\n                      make (on your yes, typed or --yes) or reuse your private repo and clone your login's folder from it, sync each scope with its repo now, read the extensions, put an item's next revision from a file, a folder or stdin with its reason and attachments as one commit in its scope, search them, export or import every scope as a folder of clones, seed the guards' lists from a folder of list files, bring each job folder in as an org's script once at the switch, and score, accept or reject a proposal\nplayground migrate --archive <checkout> --pre-squash <sha> --org <org> [--old <rev>] [--dry-run]\n                      once, at the switch: move the old data folder in ~/.claude to ~/.playground, seed your login's settings and the release owners' list from the archive checkout (its canary, or --old, and the pre-squash head), bring the hand-made skills into the org's scope unless its clone holds them, then, with the Dashboard's job stopped, make each move the migration table at the pre-squash head lists: renamed and dropped jobs, archived stale copies, moved state files, and renamed variables in your profiles and LaunchAgents, and last runs playground herdr pin; a value already set is left\nplayground uninstall [--purge]\n                      remove the LaunchAgents that run from this checkout or the data folder, stop the Dashboard's stack and remove every link into this checkout; --purge also removes the data folder and the Dashboard's database, after asking\nplayground add [--kind worker|runner] [<name>] [--title \"<title>\"] [--brief <file>] [--model <id>] [--backend glm|claude]\n                      start a worker (or a runner) through spawn.sh, under the name given or one bun run name picks, on handoffs/new-worker.md by default; a worker needs --title, a plain title of up to 40 characters, and a runner takes its name and no --title\nplayground add --dispatcher --backend glm\n                      start a second dispatcher on GLM\nplayground alerts-wait <name>\n                      for a manager's background task: wait for the next stuck alert addressed to <name>, print it and exit, so it wakes without waiting on the relay\nplayground picker <session> allow <key> | deny <key> \"<reason>\"\n                      as the session's manager, answer the permission prompt its stuck alert named by key: allow presses Yes once, deny presses No and sends the session the reason; each answer is a line in ops/picker.log";
export declare const VERBS: string[];
export declare const verbArgv: (verb: string, words: string[]) => string[];
export declare const VIEW_HINT = "Sessions: playground view opens them in herdr";
export declare function runStart(herdr: () => Promise<number>, dashboard: () => Promise<number>): Promise<number>;
export declare function runStatus(herdr: () => Promise<number>, dashboard: () => Promise<void>): Promise<number>;
export declare const WORDS: Record<string, number | "rest">;
export declare const usageOf: (command: string) => string;
export declare const extraWordRefusal: ([command, ...rest]: string[]) => string | null;
export declare const wantsHelp: ([command, ...rest]: string[]) => boolean;
export declare const leftLines: (failed: string[]) => string[];
export declare const planStart: (probes: Probes) => Step[];
export declare const modelOf: (backend: Backend | null) => string;
export declare const statusLines: (probes: Probes, terminal: string) => string[];
export type AddCommand = {
    argv: string[];
    started: string;
} | {
    error: string;
};
export declare const addCommand: (args: string[], exists: (brief: string) => boolean, pickName: (kind: string) => string, models: string[]) => AddCommand;
export type RollOutcome = {
    phase: "building" | "going back" | "switching";
} | {
    done: string;
    ok: boolean;
};
export declare const rollOutcome: (log: string[], results: string[]) => RollOutcome;
export type DashboardBeat = {
    ageMs: number;
    cycleSeconds: number;
    running: boolean;
};
type WaitRead = {
    api: boolean;
    beat: DashboardBeat | null;
    now: number;
};
type WaitOutcome = {
    done: string;
    ok: boolean;
} | {
    progress: string | null;
};
export declare const dashboardBeatOf: (json: unknown, now: number, alive: (pid: number) => boolean) => DashboardBeat | null;
export declare const staleBeat: (beat: DashboardBeat) => boolean;
export declare const waitOutcome: (read: WaitRead, state: {
    shownAt: number;
    startedAt: number;
}) => WaitOutcome;
export {};
