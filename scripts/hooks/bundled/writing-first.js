// @bun
const __CHECKOUT = import.meta.dir.slice(0, import.meta.dir.lastIndexOf("/scripts/hooks/bundled"));

// scripts/hooks/writing-first.ts
import { existsSync, readdirSync, realpathSync, unlinkSync } from "fs";
import { homedir as homedir3 } from "os";
import { basename, dirname, isAbsolute, join as join3, relative, resolve as resolve2, sep } from "path";

// packages/env/src/aliases.ts
var DESK_ENV = new Set([
  "APPROVALS_ENABLED",
  "ATTACHMENTS_DIR",
  "BARE_NAMES",
  "CHANGELOG_DIR",
  "DATA_DIR",
  "DEBUG_",
  "DEBUG_PASTE_DIR",
  "DISPATCHER",
  "DISPATCHER_SECONDARY",
  "FIXTURE",
  "FIXTURE_DIR",
  "FIXTURE_LAUNCHED",
  "HERDR_",
  "HERDR_ALONE",
  "HERDR_DIR",
  "HERDR_SESSION",
  "HERDR_SESSIONS",
  "LIVE_READS",
  "MERGED_PULLS",
  "OWNER_NAME",
  "PREVIEWS_DIR",
  "SDK_PERMISSION_MODE",
  "SDK_PROBE_DIR"
]);
var RENAMED_ENV = {
  PLAYGROUND_CMUX_SESSIONS: "PLAYGROUND_ALL_SESSIONS"
};
var renamedEnv = (name) => {
  if (Object.hasOwn(RENAMED_ENV, name))
    return RENAMED_ENV[name];
  if (!name.startsWith("DESK_"))
    return;
  const rest = name.slice("DESK_".length);
  if (DESK_ENV.has(rest) || [...DESK_ENV].some((p) => p.endsWith("_") && rest.startsWith(p)))
    return `PLAYGROUND_${rest}`;
};
var applyEnvAliases = (env = process.env) => {
  for (const [name, value] of Object.entries(env)) {
    const renamed = renamedEnv(name);
    if (renamed && !env[renamed])
      env[renamed] = value;
  }
};
applyEnvAliases();

// packages/env/src/data-dir.ts
import { homedir } from "os";
import { join, resolve } from "path";
var dataDirOf = (env, home = env.HOME || homedir()) => env.PLAYGROUND_DATA_DIR ? resolve(env.PLAYGROUND_DATA_DIR) : join(home, ".playground");

// packages/safe-delete/src/index.ts
var LIMITS = { bytes: 2 * 1024 ** 3, files: 5000, perMinute: 3 };
var CARVE_OUTS = {
  "dashboard-supervisor": {
    bytes: 256 * 1024 ** 2,
    files: 4000,
    folder: "ops/dashboard/builds"
  },
  jobs: { bytes: 64 * 1024, files: 1, folder: "ops/launch-agents" }
};

// scripts/hooks/role.ts
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";

// packages/config/src/kinds.ts
var ROSTER_KINDS = [
  "assistant",
  "builder",
  "dispatcher",
  "ops",
  "optimizer",
  "planner",
  "probe",
  "researcher",
  "reviewer",
  "runner",
  "tester",
  "worker"
];
var isRosterKind = (value) => ROSTER_KINDS.includes(value);
var FACTORY_ROLE_OF_KIND = {
  assistant: "lead",
  builder: "lead",
  dispatcher: "dispatcher",
  ops: "lead",
  optimizer: "lead",
  planner: "lead",
  probe: "probe",
  researcher: "worker",
  reviewer: "reviewer",
  runner: "runner",
  tester: "tester",
  worker: "worker"
};
var ID_ALPHABET = "23456789bcdfghjkmnpqrstvwxyz";
var ID_NAME_SOURCE = `[${ID_ALPHABET}]{6}-(?:${ROSTER_KINDS.join("|")})`;
var PREFIXED = /^(probe|reviewer|runner|tester|worker)-./;
var ID_NAME = new RegExp(`^[${ID_ALPHABET}]{6}-(${ROSTER_KINDS.join("|")})$`);
var kindOfName = (name) => (ID_NAME.exec(name) ?? PREFIXED.exec(name))?.[1] ?? null;
var DEFAULT_SESSION_NAMES = {
  aliases: {},
  names: { builder: "builder", dispatcher: "dispatcher", ops: "ops", planner: "planner" }
};
var NAMES = Symbol.for("playground.sessionNames");
var held = globalThis;
var setSessionNames = (next) => {
  held[NAMES] = next;
};
var getSessionNames = () => held[NAMES] ?? DEFAULT_SESSION_NAMES;
var namedKinds = () => {
  const { aliases, names } = getSessionNames();
  return new Map([
    ...Object.entries(names).map(([kind, name]) => [name, kind]),
    [`${names.dispatcher}-2`, "dispatcher"],
    ...Object.entries(aliases),
    ["optimizer", "optimizer"]
  ]);
};
var placedKindOfName = (name) => kindOfName(name) ?? namedKinds().get(name) ?? null;
function roleOfName(name) {
  const kind = placedKindOfName(name);
  return kind ? FACTORY_ROLE_OF_KIND[kind] : "";
}
var SEATLESS = new Set(["ended", "parked"]);

// scripts/hooks/role.ts
var MANAGER_ROLES = new Set(["dispatcher", "lead", "manager"]);
var names;
function loadNames(environment = process.env) {
  names ??= (async () => {
    try {
      const setting = join2(__CHECKOUT + "/scripts/hooks", "../../packages/scripts/src/playground/setting.ts");
      const read = Bun.spawn(["bun", setting, "sessions.names", "sessions.aliases"], {
        env: { ...process.env, ...environment },
        stderr: "ignore",
        stdout: "pipe"
      });
      const [names, aliases] = (await new Response(read.stdout).text()).trim().split(`
`);
      if (await read.exited === 0)
        setSessionNames({ aliases: JSON.parse(aliases), names: JSON.parse(names) });
    } catch {}
  })();
  return names;
}
async function registryName(sessionId, environment = process.env) {
  const dir = join2(environment.CLAUDE_CONFIG_DIR || join2(homedir2(), ".claude"), "sessions");
  for await (const file of new Bun.Glob("*.json").scan(dir)) {
    try {
      const entry = await Bun.file(join2(dir, file)).json();
      if (entry.sessionId === sessionId && typeof entry.name === "string")
        return entry.name;
    } catch {}
  }
}
async function rosterRole(name, environment = process.env) {
  const path = join2(dataDirOf(environment), "roster.json");
  try {
    const roster = await Bun.file(path).json();
    const kind = roster.agents?.find((agent) => agent?.name === name)?.kind;
    return isRosterKind(kind) ? FACTORY_ROLE_OF_KIND[kind] : "";
  } catch {
    return "";
  }
}
async function sessionRole(environment, sessionId) {
  if (environment.PLAYGROUND_ROLE)
    return environment.PLAYGROUND_ROLE;
  if (typeof sessionId !== "string")
    return "";
  try {
    const name = await registryName(sessionId, environment) ?? "";
    const role = name && await rosterRole(name, environment);
    if (role)
      return role;
    await loadNames(environment);
    return roleOfName(name);
  } catch {
    return "";
  }
}
async function fromFactory(raw, environment = process.env) {
  return await sessionRole(environment, sessionOf(raw)) !== "";
}
function sessionOf(raw) {
  try {
    return JSON.parse(raw).session_id;
  } catch {
    return;
  }
}

// packages/scripts/src/vendor-upstream/stage.ts
var UPSTREAM_SKILLS = [
  "code-review",
  "codebase-design",
  "diagnosing-bugs",
  "domain-modeling",
  "handoff",
  "research",
  "tdd",
  "to-spec",
  "writing-for-agents"
];

// scripts/hooks/writing-first.ts
var SKILL = "writing-for-agents";
var WRITES = new Set(["Edit", "MultiEdit", "Write"]);
var ID = /^[\w-]+$/;
var LOADS = new RegExp(`^(?:[\\w./-]+:)?${SKILL}$`);
var TYPED = new RegExp(`^\\s*/(?:[\\w./-]+:)?${SKILL}(?:\\s|$)`);
var FACTORY_MARKERS = [
  join3("extensions", "core", "skills", "playbook", "SKILL.md"),
  ...["playground", "engineering"].map((folder) => join3("skills", folder, "playground-factory", "SKILL.md"))
];
var configDir = (env) => env.CLAUDE_CONFIG_DIR || join3(env.HOME || homedir3(), ".claude");
var marks = (env) => join3(dataDirOf(env), "writing-first");
function markOf(input, env) {
  const session = typeof input.session_id === "string" ? input.session_id : "";
  const agent = typeof input.agent_id === "string" ? input.agent_id : "";
  if (!ID.test(session) || agent && !ID.test(agent))
    return;
  return join3(marks(env), agent ? `${session}.${agent}` : session);
}
function real(path) {
  let head = path;
  const tail = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head)
      return path;
    tail.unshift(basename(head));
    head = parent;
  }
  return join3(realpathSync(head), ...tail);
}
var inside = (path, dir) => {
  const rel = relative(dir, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
function repoOf(path) {
  for (let dir = dirname(path);; dir = dirname(dir)) {
    if (existsSync(join3(dir, ".git")))
      return dir;
    if (dirname(dir) === dir)
      return;
  }
}
async function vendored(repo, name) {
  const file = Bun.file(join3(repo, "skills", "zerostarter", name, "SKILL.md"));
  if (!await file.exists())
    return false;
  const source = /^source:\s*(\S+)/m.exec(await file.text())?.[1];
  return source !== undefined && !source.startsWith("https://");
}
async function scoped(path, env) {
  const handoffs = real(join3(dataDirOf(env), "handoffs"));
  if (inside(path, handoffs))
    return true;
  const repo = repoOf(path);
  if (!repo || !FACTORY_MARKERS.some((marker) => existsSync(join3(repo, marker))))
    return false;
  const rel = relative(repo, path).split(sep).join("/");
  const upstream = /^extensions\/core\/skills\/([^/]+)\//.exec(rel)?.[1];
  if (upstream && UPSTREAM_SKILLS.includes(upstream))
    return false;
  const zerostarter = /^skills\/zerostarter\/([^/]+)\//.exec(rel)?.[1];
  if (zerostarter)
    return !await vendored(repo, zerostarter);
  return rel.startsWith("skills/") || /^extensions\/[^/]+\/(skills|rules)\//.test(rel) || rel.startsWith(".agents/dashboard/") || rel.startsWith("docs/") || /^\.agents\/[^/]+\.md$/.test(rel) || ["AGENTS.md", "CLAUDE.md", "scripts/README.md", "scripts/hooks/README.md"].includes(rel);
}
var plugins = async (env, cwd) => {
  const read = async (file) => {
    try {
      return await Bun.file(join3(configDir(env), file)).json();
    } catch {
      return;
    }
  };
  const listed = await read(join3("plugins", "installed_plugins.json"));
  const enabled = (await read("settings.json"))?.enabledPlugins;
  return Object.entries(listed?.plugins ?? {}).flatMap(([key, installs]) => (Array.isArray(installs) ? installs : []).flatMap((install) => {
    if (typeof install?.installPath !== "string")
      return [];
    const loads = install.scope === "user" ? enabled?.[key] === true : typeof install.projectPath === "string" && !!cwd && !relative(install.projectPath, cwd).startsWith("..");
    return loads ? [install.installPath] : [];
  }));
};
var installed = async (env, cwd) => [configDir(env), ...cwd ? [join3(cwd, ".claude")] : [], ...await plugins(env, cwd)].some((dir) => existsSync(join3(dir, "skills", SKILL, "SKILL.md")));
async function mark(input, env) {
  const file = markOf(input, env);
  if (file)
    await Bun.write(file, "");
}
function clear(input, env) {
  const session = typeof input.session_id === "string" ? input.session_id : "";
  if (!ID.test(session) || !existsSync(marks(env)))
    return;
  for (const name of readdirSync(marks(env)))
    if (name === session || name.startsWith(`${session}.`))
      unlinkSync(join3(marks(env), name));
}
async function judge(input, env) {
  const target = input.tool_input?.file_path;
  const file = markOf(input, env);
  if (typeof target !== "string" || !file)
    return;
  const cwd = typeof input.cwd === "string" ? input.cwd : undefined;
  const path = real(resolve2(cwd ?? "/", target));
  if (!await scoped(path, env) || existsSync(file))
    return;
  if (!await installed(env, cwd))
    return;
  const who = typeof input.agent_id === "string" && input.agent_id ? "this subagent" : "this session";
  return `writing-first hook refuses this ${String(input.tool_name)} to ${target}: it is an agent-facing doc, and ${who} has not loaded ${SKILL} since its last compaction. Call the Skill tool with skill "${SKILL}", or the scoped name your skill list shows for it (such as "ws-home:${SKILL}"), follow it, then retry this write (playbook's **writing** rule).`;
}
async function check(raw, env = process.env) {
  try {
    const input = JSON.parse(raw);
    if (typeof input !== "object" || input === null)
      return;
    const event = input.hook_event_name;
    if (event === "PreToolUse" && input.tool_name === "Skill") {
      const skill = input.tool_input?.skill;
      if (typeof skill === "string" && LOADS.test(skill))
        await mark(input, env);
      return;
    }
    if (event === "UserPromptSubmit") {
      if (typeof input.prompt === "string" && TYPED.test(input.prompt))
        await mark(input, env);
      return;
    }
    if (event === "SessionStart") {
      if (input.source === "compact")
        clear(input, env);
      return;
    }
    if (event === "PreToolUse" && WRITES.has(String(input.tool_name)))
      return await judge(input, env);
  } catch {
    return;
  }
}
if (import.meta.main) {
  const raw = await Bun.stdin.text();
  const reason = await fromFactory(raw) ? await check(raw) : undefined;
  if (reason) {
    console.error(reason);
    process.exit(2);
  }
}
export {
  SKILL,
  check
};
