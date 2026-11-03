// @bun
const __CHECKOUT = import.meta.dir.slice(0, import.meta.dir.lastIndexOf("/scripts/hooks/bundled"));

// scripts/hooks/no-extensions-write.ts
import { existsSync, statSync } from "fs";
import { homedir as homedir4 } from "os";
import { dirname as dirname2, join as join6, resolve as resolve4, sep as sep2 } from "path";

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
var renamedEnv = (name) => {
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
var dataDir = (env = process.env) => dataDirOf(env);

// packages/settings/src/rendered.ts
import { join as join2 } from "path";
var extensionsDir = (data) => join2(data, "extensions");

// scripts/hooks/no-main-checkout.ts
import { readFileSync, realpathSync } from "fs";
import { basename as basename2, dirname, isAbsolute as isAbsolute2, join as join5, normalize, resolve as resolve3, sep } from "path";

// scripts/hooks/role.ts
import { homedir as homedir2 } from "os";
import { join as join3 } from "path";

// packages/config/src/kinds.ts
var ROSTER_KINDS = [
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
      const setting = join3(__CHECKOUT + "/scripts/hooks", "../../packages/scripts/src/playground/setting.ts");
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
  const dir = join3(environment.CLAUDE_CONFIG_DIR || join3(homedir2(), ".claude"), "sessions");
  for await (const file of new Bun.Glob("*.json").scan(dir)) {
    try {
      const entry = await Bun.file(join3(dir, file)).json();
      if (entry.sessionId === sessionId && typeof entry.name === "string")
        return entry.name;
    } catch {}
  }
}
async function rosterRole(name, environment = process.env) {
  const path = join3(dataDirOf(environment), "roster.json");
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

// scripts/hooks/shell.ts
import { homedir as homedir3 } from "os";
import { basename, isAbsolute, resolve as resolve2 } from "path";
var UNKNOWN = "\x00";
var READ = "\x01";
var MAX_BYTES = 1048576;
var MAX_SCRIPT = 131072;
var LARGE = "a text too large to read";
var deadline;
async function withDeadline(budget, body) {
  const outer = deadline;
  deadline = performance.now() + budget;
  try {
    return await body();
  } finally {
    deadline = outer;
  }
}
var steps = 0;
function tick() {
  if (deadline === undefined || ++steps % 1024 !== 0)
    return;
  if (performance.now() > deadline)
    throw new RangeError("past the hook's time");
}
function lexScript(value, env) {
  if (deadline !== undefined && value.length > MAX_SCRIPT)
    throw new RangeError("a script too large to read");
  return lex(value, env.known);
}
function filled(script, mark, value) {
  const count = script.split(mark).length - 1;
  if (deadline !== undefined && script.length + count * value.length > MAX_SCRIPT)
    throw new RangeError("a script too large to read");
  return script.replaceAll(mark, value);
}
var held2 = (text) => text.value.length > MAX_BYTES ? unknown(LARGE) : text;
var BREAK = new Set([" ", "\t", `
`, ";", "&", "|", "<", ">", "(", ")"]);
var REDIRECT = /^(\d*|&)(<<<|<<-|<<|<>|<&|>&!?|>>[!|]?|>[!|]|<|>)/;
var RESERVED = new Set([
  "!",
  "{",
  "}",
  "coproc",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "if",
  "then",
  "until",
  "while"
]);
var ownFirst = (cmd, first) => !!first && first === cmd.words.find((w) => w.quoted || !RESERVED.has(w.value));
var onlyReserved = (cmd) => cmd.words.length > 0 && cmd.words.every((w) => !w.quoted && RESERVED.has(w.value));
var GROUPING = new Set(["}", "done", "esac", "fi"]);
var ASSIGN = /^[A-Za-z_]\w*=/;
var WRAPPERS = new Map(Object.entries({
  builtin: ["", ""],
  caffeinate: ["-d -i -m -s -u", "-t -w"],
  command: ["-p -V -v", ""],
  doas: ["-L -n -s", "-a -C -u"],
  env: ["-0 -i -v --debug --ignore-environment --null", "-P -S -u --unset"],
  exec: ["-c -l", "-a"],
  nice: ["", "-n --adjustment"],
  nocorrect: ["", ""],
  noglob: ["", ""],
  nohup: ["", ""],
  repeat: ["", ""],
  stdbuf: ["", "-e -i -o --error --input --output"],
  sudo: [
    "-A -B -b -E -e -H -i -K -k -l -N -n -P -S -s -V -v --askpass --background --bell --edit --help --list --login --non-interactive --preserve-env --preserve-groups --remove-timestamp --reset-timestamp --set-home --shell --stdin --validate --version",
    "-C -D -g -h -p -R -r -T -t -U -u --chdir --chroot --close-from --command-timeout --group --host --other-user --prompt --role --type --user"
  ],
  time: [
    "-a -h -l -p -q -V -v --append --portability --quiet --verbose",
    "-f -o --format --output"
  ],
  timeout: ["-f -p -v --foreground --preserve-status --verbose", "-k -s --kill-after --signal"],
  xargs: [
    "-0 -o -p -r -t -x --exit --interactive --no-run-if-empty --null --open-tty --show-limits --verbose",
    "-a -d -E -L -n -P -R -S -s --arg-file --delimiter --max-args --max-chars --max-lines --max-procs --process-slot-var"
  ]
}).map(([name, [flags, values]]) => [
  name,
  { flags: new Set(flags.split(" ")), values: new Set(values.split(" ")) }
]));
function optionValue(word, { flags, values }) {
  if (word.startsWith("--")) {
    const eq = word.indexOf("=");
    const name = eq === -1 ? word : word.slice(0, eq);
    if (values.has(name))
      return eq === -1 ? "next" : "own";
    return flags.has(name) ? "own" : undefined;
  }
  for (let k = 1;k < word.length; k++) {
    const option = `-${word[k]}`;
    if (values.has(option))
      return k === word.length - 1 ? "next" : "own";
    if (!flags.has(option))
      return;
  }
  return "own";
}
var ROOT_SHELLS = new Map([
  ["doas", new Set(["-s"])],
  ["sudo", new Set(["--login", "--shell", "-i", "-s"])]
]);
function stdinShell(cmd) {
  const parsed = parse(cmd);
  const kinds = readings(parsed).map((reading) => stdinShellOf(cmd, reading));
  if (parsed.capped) {
    const names = cmd.words.map((w) => program(w.value));
    if (names.some((n) => ROOT_SHELLS.has(n)))
      kinds.push("root");
    else if (names.some((n) => SHELLS.has(n)))
      kinds.push("shell");
  }
  return kinds.includes("root") ? "root" : kinds.find(Boolean);
}
function stdinShellOf(cmd, { args, first, name }) {
  if (first && !marked(first.value)) {
    if (!SHELLS.has(name))
      return;
    const { inline, operand } = shellOperand(args, name);
    return inline || operand ? undefined : "shell";
  }
  let at = 0;
  for (let w = cmd.words[at];w && !w.quoted; w = cmd.words[at]) {
    if (w.value === "function")
      at += 2;
    else if (RESERVED.has(w.value) || ASSIGN.test(w.value))
      at++;
    else
      break;
  }
  const end = first ? cmd.words.indexOf(first) : -1;
  const before = cmd.words.slice(at, end === -1 ? undefined : end);
  const k = before.findIndex((w) => !w.quoted && ROOT_SHELLS.has(program(w.value)));
  if (k === -1)
    return;
  const wrapper = program(before[k].value);
  const shells = ROOT_SHELLS.get(wrapper);
  const { flags, values } = WRAPPERS.get(wrapper);
  const clustered = (value) => {
    let shell = false;
    for (const c of value.slice(1)) {
      if (values.has(`-${c}`))
        return shell;
      if (!flags.has(`-${c}`))
        return false;
      shell ||= shells.has(`-${c}`);
    }
    return shell;
  };
  const starts = ({ quoted, value }) => marked(value) || !quoted && (shells.has(value) || /^-[A-Za-z]/.test(value) && clustered(value));
  return !!first || before.slice(k + 1).some(starts) ? "root" : undefined;
}
var COUNTED = new Set(["repeat", "timeout"]);
var SHELLS = new Set(["bash", "dash", "ksh", "sh", "zsh"]);
var EXPORTS = new Set(["declare", "export", "local", "readonly", "typeset"]);
var PRINTERS = new Set(["echo", "printf"]);
var GIT_TAKES = new Set([
  "-C",
  "-c",
  "--attr-source",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--work-tree"
]);
var API_FIELDS = new Set(["-F", "--field", "-f", "--raw-field"]);
var API_TAKES = new Set([
  ...API_FIELDS,
  "--cache",
  "-H",
  "--header",
  "--hostname",
  "--input",
  "-p",
  "--preview",
  "-q",
  "--jq",
  "-t",
  "--template",
  "-X",
  "--method"
]);
var CURL_DATA = new Set([
  "-d",
  "--data",
  "--data-ascii",
  "--data-binary",
  "--data-raw",
  "--data-urlencode",
  "-F",
  "--form",
  "--form-string",
  "--json",
  "-T",
  "--upload-file"
]);
var CURL_TAKES = new Set([
  ...CURL_DATA,
  "-A",
  "--user-agent",
  "-b",
  "--cookie",
  "-c",
  "--cookie-jar",
  "-D",
  "--dump-header",
  "-e",
  "--referer",
  "-H",
  "--header",
  "-K",
  "--config",
  "-m",
  "--max-time",
  "-o",
  "--output",
  "-u",
  "--user",
  "--url",
  "-w",
  "--write-out",
  "-X",
  "--request",
  "-x",
  "--proxy"
]);
var ESCAPES = {
  '"': '"',
  "'": "'",
  "?": "?",
  "\\": "\\",
  a: "\x07",
  b: "\b",
  E: "\x1B",
  e: "\x1B",
  f: "\f",
  n: `
`,
  r: "\r",
  t: "\t",
  v: "\v"
};
var unknown = (why) => ({ unknown: why, value: UNKNOWN });
var setLog = new WeakMap;
var setVar = (vars, key, value) => {
  vars.set(key, value);
  const log = setLog.get(vars);
  if (log)
    log.push(key);
  else
    setLog.set(vars, [key]);
};
function varsSince(vars, cursor) {
  const log = setLog.get(vars) ?? [];
  return [cursor === undefined ? [...vars.keys()] : log.slice(cursor), log.length];
}
var merge = (out, part) => {
  out.value += part.value;
  if (part.unknown)
    out.unknown ??= part.unknown;
  if (part.variable)
    out.variable ??= part.variable;
  if (part.reads?.length)
    (out.reads ??= []).push(...part.reads);
};
var join4 = (parts, separator = "") => {
  const out = { value: "" };
  parts.forEach((part, k) => {
    if (k > 0)
      out.value += separator;
    merge(out, part);
  });
  return out;
};
var slice = (word, from) => {
  const dropped = word.value.slice(0, from).split(READ).length - 1;
  return { ...word, reads: word.reads?.slice(dropped), value: word.value.slice(from) };
};
var marked = (value) => value.includes(UNKNOWN) || value.includes(READ);
var program = (value) => basename(value.replace(/^=/, ""));
var UV_TAKES = new Set([
  "--cache-dir",
  "--config-file",
  "--directory",
  "--env-file",
  "--extra",
  "--extra-index-url",
  "--from",
  "--group",
  "--index",
  "--index-url",
  "--package",
  "--project",
  "-p",
  "--python",
  "--with",
  "--with-editable",
  "--with-requirements"
]);
function decode(raw) {
  return raw.replace(/\\(?:x([\da-fA-F]{1,2})|u([\da-fA-F]{1,4})|U([\da-fA-F]{1,8})|0?([0-7]{1,3})|([\s\S]))/g, (whole, hex, u4, u8, octal, other) => {
    const point = hex || u4 || u8 ? Number.parseInt(hex ?? u4 ?? u8 ?? "", 16) : Number.parseInt(octal ?? "", 8);
    if (!Number.isNaN(point))
      return point <= 1114111 ? String.fromCodePoint(point) : whole;
    return ESCAPES[other ?? ""] ?? whole;
  });
}
function lex(src, known = {}) {
  const lx = { commands: [], i: 0, known, scope: 0, scopes: [-1], src };
  list(lx, 0, false);
  return { commands: lx.commands, scopes: lx.scopes };
}
function nest(lx, inherit) {
  list(lx, lx.scopes.push(lx.scope) - 1, true, inherit);
}
function list(lx, scope, nested, inherit) {
  const outer = lx.scope;
  lx.scope = scope;
  try {
    walk(lx, scope, nested, inherit);
  } finally {
    lx.scope = outer;
  }
}
function walk(lx, scope, nested, inherit) {
  const { src } = lx;
  const pending = [];
  const fresh = () => ({ redirects: [], scope, stdin: inherit, words: [] });
  let cmd = fresh();
  const opens = [];
  const end = (op) => {
    const done = cmd;
    const pipe = op === "|" || op === "|&";
    const brace = (c, value) => c.words[0]?.value === value && !c.words[0].quoted;
    if (brace(done, "}")) {
      const open = opens.pop();
      if (open !== undefined) {
        const { commands } = lx;
        const close = commands.length;
        done.inner = () => topLevel(commands.slice(open, close), scope);
      }
    }
    if (pipe || op === "&")
      done.detached = true;
    if (done.words.length > 0 || done.redirects.length > 0 || done.group) {
      for (const w of done.words) {
        if (w.value !== "{" || w.quoted)
          break;
        opens.push(lx.commands.length);
      }
      lx.commands.push(done);
    }
    cmd = fresh();
    if (pipe) {
      cmd.stdin = done;
      cmd.detached = true;
    }
  };
  while (lx.i < src.length) {
    tick();
    const c = src[lx.i];
    const redirect = REDIRECT.exec(src.slice(lx.i, lx.i + 8));
    if (c === " " || c === "\t")
      lx.i++;
    else if (c === "\\" && src[lx.i + 1] === `
`)
      lx.i += 2;
    else if (c === `
`) {
      lx.i++;
      heredocs(lx, pending, nested);
      end(";");
    } else if (c === "#") {
      while (lx.i < src.length && src[lx.i] !== `
`)
        lx.i++;
    } else if (c === ")") {
      lx.i++;
      end(";");
      if (nested)
        return;
    } else if (c === "(") {
      lx.i++;
      const piped = cmd.words.length === 0 && cmd.redirects.length === 0 ? cmd.stdin : undefined;
      end(";");
      const from = lx.commands.length;
      const scope = lx.scopes.length;
      nest(lx, piped);
      cmd.group = true;
      const members = topLevel(lx.commands.slice(from), scope);
      cmd.inner = () => members;
    } else if ((c === "<" || c === ">") && src[lx.i + 1] === "(") {
      cmd.words.push(procSub(lx));
    } else if (redirect) {
      lx.i += redirect[0].length;
      while (src[lx.i] === " " || src[lx.i] === "\t")
        lx.i++;
      const [, fd] = redirect;
      const op = redirect[2].replace(/!$/, "|").replace(/^(>[>&])\|$/, "$1");
      const target = src.startsWith("<(", lx.i) ? procSub(lx) : word(lx);
      const entry = { fd, op, target };
      if (op === "<<" || op === "<<-") {
        pending.push({
          delim: target.value,
          quoted: target.quoted,
          redirect: entry,
          strip: op === "<<-"
        });
      } else if (op === "<<<")
        entry.body = { ...target, value: `${target.value}
` };
      cmd.redirects.push(entry);
    } else if (c === ";" || c === "&" || c === "|") {
      const two = src.slice(lx.i, lx.i + 2);
      const op = ["&&", ";;", "|&", "||"].includes(two) ? two : c;
      lx.i += op.length;
      end(op);
    } else {
      const from = lx.i;
      cmd.words.push(word(lx));
      if (lx.i === from)
        lx.i++;
    }
  }
  heredocs(lx, pending, nested);
  end(";");
}
function topLevel(cmds, scope) {
  const fed = new Set(cmds.map((c) => c.stdin));
  return cmds.filter((c) => !fed.has(c) && c.scope === scope);
}
function procSub(lx) {
  lx.i += 2;
  const from = lx.commands.length;
  const scope = lx.scopes.length;
  nest(lx);
  return {
    procs: topLevel(lx.commands.slice(from), scope),
    quoted: false,
    ...unknown("a process substitution")
  };
}
function heredocs(lx, pending, nested) {
  for (const doc of pending.splice(0)) {
    const lines = [];
    while (lx.i < lx.src.length) {
      tick();
      const start = lx.i;
      const newline = lx.src.indexOf(`
`, start);
      const stop = newline === -1 ? lx.src.length : newline;
      const raw = lx.src.slice(start, stop);
      const line = doc.strip ? raw.replace(/^\t+/, "") : raw;
      lx.i = stop + 1;
      if (line === doc.delim)
        break;
      if (nested && line.startsWith(`${doc.delim})`)) {
        lx.i = start + raw.length - line.length + doc.delim.length;
        break;
      }
      lines.push(line);
    }
    const body = lines.map((line) => `${line}
`).join("");
    doc.redirect.body = doc.quoted ? { value: body } : expandHeredoc(body);
  }
}
function expandHeredoc(body) {
  const joined = body.replaceAll("\\\n", "");
  const value = joined.replace(/\\([\\$`])/g, "$1");
  return /\$[\w{(@*#?!$-]|`/.test(joined.replace(/\\[\\$`]/g, "")) ? { unknown: "an expansion in an unquoted heredoc", value } : { value };
}
function word(lx) {
  const { src } = lx;
  const start = lx.i;
  const out = { quoted: false, value: "" };
  let bare = "";
  while (lx.i < src.length && (!BREAK.has(src[lx.i]) || src[lx.i] === "(" && lx.i > start && src[lx.i + 1] !== ")")) {
    tick();
    const c = src[lx.i];
    const next = src[lx.i + 1] ?? "";
    if (c === "(") {
      const end = balanced(src, lx.i, "(", ")");
      out.value += src.slice(lx.i, end);
      bare += src.slice(lx.i, end);
      inner(lx, src.slice(lx.i + 1, end - 1));
      lx.i = end;
    } else if (c === "\\") {
      out.quoted = true;
      if (next !== `
`)
        out.value += next;
      lx.i += 2;
    } else if (c === "'") {
      out.quoted = true;
      const close = src.indexOf("'", lx.i + 1);
      const stop = close === -1 ? src.length : close;
      out.value += src.slice(lx.i + 1, stop);
      lx.i = stop + 1;
    } else if (c === '"') {
      out.quoted = true;
      lx.i++;
      merge(out, double(lx));
    } else if (c === "$" && next === "'") {
      out.quoted = true;
      merge(out, ansi(lx));
    } else if (c === "$" && next === '"')
      lx.i++;
    else if (c === "$" || c === "`") {
      const text = c === "$" ? dollar(lx) : backtick(lx);
      merge(out, text);
      if (GLOB_CHARS.test(text.value))
        out.glob = true;
    } else if (c === "~" && lx.i === start && (next === "" || next === "/" || BREAK.has(next))) {
      out.value += homedir3();
      lx.i++;
    } else {
      out.value += c;
      bare += c;
      lx.i++;
    }
  }
  if (/\{(?=[^{}]*\})[^{}]*(?:,|\.\.)/.test(bare))
    out.unknown ??= "a brace expansion";
  if (GLOB_CHARS.test(bare))
    out.glob = true;
  return out;
}
var GLOB_CHARS = /[*?[{(]/;
function double(lx) {
  const { src } = lx;
  const out = { value: "" };
  while (lx.i < src.length && src[lx.i] !== '"') {
    const c = src[lx.i];
    const next = src[lx.i + 1] ?? "";
    if (c === "\\") {
      if (next !== `
`)
        out.value += '$`"\\'.includes(next) ? next : c + next;
      lx.i += 2;
    } else if (c === "$")
      merge(out, dollar(lx));
    else if (c === "`")
      merge(out, backtick(lx));
    else {
      out.value += c;
      lx.i++;
    }
  }
  lx.i++;
  return out;
}
function ansi(lx) {
  const { src } = lx;
  let i = lx.i + 2;
  while (i < src.length && src[i] !== "'")
    i += src[i] === "\\" ? 2 : 1;
  const raw = src.slice(lx.i + 2, Math.min(i, src.length));
  lx.i = i + 1;
  return { value: decode(raw) };
}
function dollar(lx) {
  tick();
  const { src } = lx;
  const next = src[lx.i + 1] ?? "";
  const variable = (name) => name !== undefined && lx.known[name] !== undefined ? { value: lx.known[name], variable: name } : { ...unknown("a shell variable"), variable: name };
  if (src.startsWith("$((", lx.i)) {
    const end = balanced(src, lx.i + 1, "(", ")");
    inner(lx, src.slice(lx.i + 3, end - 2));
    lx.i = end;
    return unknown("an arithmetic expansion");
  }
  if (next === "(") {
    lx.i += 2;
    const from = lx.commands.length;
    nest(lx);
    return substituted(lx.commands.slice(from));
  }
  if (next === "{") {
    const end = balanced(src, lx.i + 1, "{", "}");
    const name = /^\$\{([A-Za-z_]\w*)\}$/.exec(src.slice(lx.i, end))?.[1];
    inner(lx, src.slice(lx.i + 2, end - 1));
    lx.i = end;
    return variable(name);
  }
  if (/[A-Za-z_]/.test(next)) {
    const from = ++lx.i;
    while (/\w/.test(src[lx.i] ?? ""))
      lx.i++;
    return variable(src.slice(from, lx.i));
  }
  if (/[\d@*#?$!-]/.test(next)) {
    lx.i += 2;
    return unknown("a shell variable");
  }
  lx.i++;
  return { value: "$" };
}
function inner(lx, src) {
  const sub = { ...lx, i: 0, src };
  while (sub.i < src.length) {
    tick();
    const from = sub.i;
    if ((src[sub.i] === "<" || src[sub.i] === ">") && src[sub.i + 1] === "(")
      procSub(sub);
    else
      word(sub);
    if (sub.i === from)
      sub.i++;
  }
}
function balanced(src, from, open, close) {
  let depth = 0;
  for (let i = from;i < src.length; i++) {
    tick();
    const c = src[i];
    if (c === "\\")
      i++;
    else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      i = end === -1 ? src.length : end;
    } else if (c === open)
      depth++;
    else if (c === close && --depth === 0)
      return i + 1;
  }
  return src.length;
}
function backtick(lx) {
  const { src } = lx;
  let i = lx.i + 1;
  let inner = "";
  while (i < src.length && src[i] !== "`") {
    if (src[i] === "\\" && i + 1 < src.length) {
      inner += "$`\\".includes(src[i + 1]) ? src[i + 1] : src[i] + src[i + 1];
      i += 2;
    } else
      inner += src[i++];
  }
  lx.i = i + 1;
  list({ ...lx, i: 0, src: inner }, lx.scopes.push(lx.scope) - 1, false);
  return unknown("a command substitution");
}
function substituted(inner) {
  const [only] = inner;
  if (inner.length !== 1 || only.stdin || only.group)
    return unknown("a command substitution");
  const [first, ...args] = only.words;
  const plainCat = first?.value === "cat" && !first.unknown && !first.reads?.length;
  const input = only.redirects[0];
  if (only.redirects.length === 1 && input.body && plainCat && args.length === 0) {
    return input.body.unknown ? input.body : { ...input.body, value: input.body.value.replace(/\n+$/, "") };
  }
  if (only.redirects.length === 0 && plainCat && args.length === 1 && !args[0].value.startsWith("-")) {
    return { reads: [args[0]], value: READ };
  }
  if (only.words.length === 0 && only.redirects.length === 1 && input.op === "<" && input.target) {
    return { reads: [input.target], value: READ };
  }
  return unknown("a command substitution");
}
var SPLIT = /^(?:-[0iv]*S|--split-string(?:=|$))(.*)$/;
var READINGS = 16;
function parse(cmd) {
  const state = { local: new Map, rest: cmd.words.toReversed(), xargs: undefined };
  const { rest } = state;
  for (let w = rest.at(-1);w && !w.quoted; w = rest.at(-1)) {
    if (RESERVED.has(w.value))
      rest.pop();
    else if (w.value === "function")
      rest.length = Math.max(0, rest.length - 2);
    else
      break;
  }
  while (ASSIGN.test(rest.at(-1)?.value ?? ""))
    assign(state.local, rest.pop());
  const budget = { left: READINGS };
  const parsed = unwrap(state, undefined, budget);
  return budget.capped ? { ...parsed, capped: true } : parsed;
}
var readings = (parsed) => [parsed, ...parsed.also.flatMap(readings)];
var assign = (local, w) => {
  const eq = w.value.indexOf("=");
  local.set(w.value.slice(0, eq), slice(w, eq + 1));
};
function unwrap(state, inside, budget) {
  const { local, rest } = state;
  const peek = () => rest[rest.length - 1];
  const take = () => rest.pop();
  const also = [];
  const fork = (wrapper, drop) => {
    if (budget.left-- <= 0) {
      budget.capped = true;
      return;
    }
    also.push(unwrap({
      chdir: state.chdir,
      local: new Map(local),
      rest: rest.slice(0, Math.max(0, rest.length - drop)),
      xargs: state.xargs && { ...state.xargs }
    }, wrapper, budget));
  };
  for (let wrapper = inside;; wrapper = undefined) {
    if (!wrapper) {
      wrapper = program(peek()?.value ?? "");
      if (!WRAPPERS.has(wrapper))
        break;
      if (wrapper === "xargs")
        state.xargs ??= {};
      take();
    }
    const options = WRAPPERS.get(wrapper);
    for (let w = peek();w; w = peek()) {
      const v = w.value;
      if (ASSIGN.test(v))
        assign(local, take());
      else if (wrapper === "env" && SPLIT.test(v)) {
        const attached = SPLIT.exec(v)?.[1] ?? "";
        take();
        const split = (attached || take()?.value || "").split(/\s+/).filter(Boolean);
        for (let j = split.length - 1;j >= 0; j--)
          rest.push({ quoted: false, value: split[j] });
      } else if (wrapper === "env" && (v === "-C" || v === "--chdir")) {
        take();
        state.chdir = take();
      } else if (wrapper === "env" && /^(?:-C|--chdir=)./.test(v)) {
        state.chdir = slice(w, v.startsWith("-C") ? 2 : "--chdir=".length);
        take();
      } else if (state.xargs && /^(?:-[IiJ]|--replace)/.test(v)) {
        const attached = /^(?:-[IiJ]|--replace=?)(.*)$/.exec(v)?.[1] ?? "";
        take();
        state.xargs.replace = v === "-I" || v === "-J" ? take()?.value : attached || "{}";
      } else if (v === "--") {
        take();
        while (ASSIGN.test(peek()?.value ?? ""))
          assign(local, take());
        break;
      } else if (v.startsWith("-") && v !== "-") {
        const end = wrapper === "nice" && /^-\d+$/.test(v) ? "own" : marked(v) ? undefined : optionValue(v, options);
        if (!end)
          fork(wrapper, 2);
        else if (end === "next" && marked(rest[rest.length - 2]?.value ?? "")) {
          fork(wrapper, 1);
          fork(wrapper, 3);
        }
        rest.length = Math.max(0, rest.length - (end === "next" ? 2 : 1));
      } else
        break;
    }
    if (COUNTED.has(wrapper))
      take();
  }
  const first = take();
  return {
    also,
    args: rest.reverse(),
    chdir: state.chdir,
    first,
    local,
    name: first ? program(first.value) : "",
    xargs: state.xargs
  };
}
function slotWords({ args, name }) {
  if (name !== "run-slot.sh")
    return;
  const at = args.findIndex((a) => a.value === "--");
  return at === -1 ? [] : args.slice(at + 1);
}
function shellSlot(args, shell) {
  const { inline, operand } = shellOperand(args, shell);
  if (inline || !operand || program(operand.value) !== "run-slot.sh")
    return;
  return args.slice(args.indexOf(operand));
}
async function run(lexed, env, visit, builtins = false) {
  if (running >= MAX_RUNS)
    throw new RangeError("scripts nested too deep");
  running++;
  try {
    return await runAll(lexed, env, visit, builtins);
  } finally {
    running--;
  }
}
var running = 0;
var MAX_RUNS = 256;
async function runAll(lexed, env, visit, builtins) {
  const envs = new Map([[0, env]]);
  const envOf = (scope) => {
    const found = envs.get(scope);
    if (found)
      return found;
    const parent = envOf(lexed.scopes[scope]);
    const child = { ...parent, vars: new Map(parent.vars) };
    envs.set(scope, child);
    return child;
  };
  for (const cmd of lexed.commands) {
    const verdict = await examine(cmd, envOf(cmd.scope), visit, builtins);
    if (verdict)
      return verdict;
  }
}
var subshell = (env) => ({ ...env, vars: new Map(env.vars) });
async function examine(cmd, env, visit, builtins) {
  tick();
  const [primary, ...others] = readings(parse(cmd));
  const before = others.length > 0 ? apart(env) : env;
  const verdict = await examineReading(cmd, primary, env, visit, builtins);
  if (verdict)
    return verdict;
  for (const parsed of others) {
    const verdict = await examineReading(cmd, parsed, apart(before), visit, builtins);
    if (verdict)
      return verdict;
  }
}
var apart = (env) => ({
  ...env,
  files: new Map(env.files),
  known: { ...env.known },
  process: { ...env.process },
  vars: new Map(env.vars)
});
async function examineReading(cmd, parsed, env, visit, builtins) {
  const { args, chdir, local, name } = parsed;
  const here = chdir ? { ...env, cwd: pathOf(chdir, env) } : env;
  let verdict;
  const followed = SHELLS.has(name) || [".", "cd", "eval", "popd", "pushd", "source"].includes(name);
  if (followed && builtins && cmd.redirects.length > 0) {
    const bare = { ...cmd, words: [] };
    verdict = await visit(bare, parse(bare), here);
    if (verdict)
      return verdict;
  }
  if (name === "") {
    for (const [key, value] of local)
      setVar(env.vars, key, value);
    if (builtins)
      verdict = await visit(cmd, parsed, here);
  } else if (name === "cd" || name === "pushd") {
    if (args.some((a) => GLOB_CHARS.test(a.value)))
      verdict = await visit(cmd, parsed, here);
    const from = env.cwd;
    env.cwd = cmd.detached ? undefined : await cdTarget(name, args, env);
    if (env.old)
      env.old = { dir: env.cwd === undefined ? undefined : from };
  } else if (name === "popd") {
    env.cwd = undefined;
    if (env.old)
      env.old = {};
  } else if (EXPORTS.has(name)) {
    for (const w of args.filter((a) => ASSIGN.test(a.value))) {
      const eq = w.value.indexOf("=");
      setVar(env.vars, w.value.slice(0, eq), slice(w, eq + 1));
    }
    if (builtins)
      verdict = await visit(cmd, parsed, here);
  } else if (SHELLS.has(name))
    verdict = await shell(name, args, cmd, here, visit, builtins, parsed.xargs);
  else if ((name === "source" || name === ".") && (args[0]?.procs || args[0]?.value === "/dev/stdin")) {
    const script = await scriptOf(args[0], cmd, here);
    verdict = (script.unknown ? await visit(cmd, parsed, here) : undefined) ?? await run(lexScript(known(script), env), here, visit, builtins);
  } else if (name === "eval") {
    verdict = await run(lexScript(args.map((a) => a.value).join(" "), env), here, visit, builtins);
  } else
    verdict = await visit(cmd, parsed, here);
  await record(cmd, name, args, here);
  return verdict;
}
async function cdTarget(name, args, env) {
  const dir = args.find((a) => !(a.value.startsWith("-") && a.value.length > 1));
  if (!dir)
    return homedir3();
  const typed = dir.value === "-" ? undefined : await folder(pathOf(dir, env));
  const tilde = !typed && name === "pushd" && env.old && !dir.quoted && !dir.unknown && !dir.reads?.length ? /^~([-+])(?=\/|$)/.exec(dir.value) : null;
  const base = tilde && (tilde[1] === "-" ? env.old?.dir : env.cwd);
  return base ? await folder(base + dir.value.slice(2)) : typed;
}
async function folder(path) {
  if (!path)
    return;
  try {
    return (await Bun.file(path).stat()).isDirectory() ? path : undefined;
  } catch {
    return;
  }
}
var SHELL_TAKES = new Set(["-o", "+o", "--init-file", "--rcfile"]);
var BASH_TAKES = new Set([...SHELL_TAKES, "-O", "+O"]);
function shellOperand(args, shell) {
  const takes = shell === "bash" || shell === "sh" ? BASH_TAKES : SHELL_TAKES;
  let inline = false;
  for (let k = 0;k < args.length; k++) {
    const v = args[k].value;
    if (takes.has(v))
      k++;
    else if (/^[-+][A-Za-z]+$/.test(v))
      inline ||= v.startsWith("-") && v.includes("c");
    else if (!v.startsWith("--"))
      return { inline, operand: args[k] };
  }
  return { inline };
}
async function shell(name, args, cmd, env, visit, builtins, xargs) {
  const slot = shellSlot(args, name);
  if (slot)
    return examine({ ...cmd, words: slot }, env, visit, builtins);
  const { inline, operand } = shellOperand(args, name);
  if (operand && inline) {
    let script = operand.value;
    if (xargs?.replace && script.includes(xargs.replace)) {
      const fed = await stdinOf(cmd, env);
      script = filled(script, xargs.replace, fed.unknown ? UNKNOWN : fed.value.trim());
    }
    return run(lexScript(script, env), subshell(env), visit, builtins);
  }
  const script = await scriptOf(operand, cmd, env);
  return run(lexScript(known(script), env), subshell(env), visit, builtins);
}
var known = (script) => script.value.replaceAll(UNKNOWN, `
`);
async function scriptOf(operand, cmd, env) {
  const script = !operand || operand.value === "/dev/stdin" ? await stdinOf(cmd, env) : operand.procs ? await outputs(operand.procs, env) : unknown("a script file");
  if (deadline !== undefined && script.unknown === LARGE)
    throw new RangeError(LARGE);
  return script;
}
async function outputs(cmds, env) {
  return join4(await Promise.all(cmds.map((c) => outputOf(c, env))));
}
async function record(cmd, name, args, env) {
  for (const r of cmd.redirects) {
    if (r.op !== ">" && r.op !== ">>" && r.op !== ">|")
      continue;
    const path = r.target && pathOf(r.target, env);
    if (!path)
      continue;
    const stdout = r.fd === "" || r.fd === "1" || r.fd === "&";
    const out = stdout ? await outputOf(cmd, env) : unknown(`what ${name || "a command"} writes to stderr`);
    env.files.set(path, held2(r.op === ">>" ? join4([await existing(path, env), out]) : out));
  }
  if (name !== "tee")
    return;
  const input = await stdinOf(cmd, env);
  const append = args.some((a) => a.value === "-a" || a.value === "--append");
  for (const a of args) {
    const path = a.value.startsWith("-") ? undefined : pathOf(a, env);
    if (path)
      env.files.set(path, held2(append ? join4([await existing(path, env), input]) : input));
  }
}
async function existing(path, env) {
  return env.files.get(path) ?? await readFile(path) ?? { value: "" };
}
async function outputOf(cmd, env) {
  tick();
  const { args, name } = parse(cmd);
  if (name === "") {
    if (cmd.inner)
      return outputs(cmd.inner(), env);
    return cmd.group || cmd.words.some((w) => GROUPING.has(w.value) && !w.quoted) ? unknown("the output of a command group") : { value: "" };
  }
  if (name === "cat") {
    const sources = args.filter((a) => a.value === "-" || !a.value.startsWith("-"));
    if (sources.length === 0)
      return stdinOf(cmd, env);
    const first = sources.findIndex((s) => s.value === "-");
    const parts = [];
    let size = 0;
    for (const [k, s] of sources.entries()) {
      tick();
      const part = s.value !== "-" ? await readPath(s, env) : k === first ? await stdinOf(cmd, env) : { value: "" };
      size += part.value.length;
      if (size > MAX_BYTES)
        return unknown(LARGE);
      parts.push(part);
    }
    return join4(parts);
  }
  if (name === "tee")
    return stdinOf(cmd, env);
  if (!PRINTERS.has(name))
    return unknown(`the output of ${name}`);
  const values = await Promise.all(args.map((a) => resolveText(a, env)));
  const hidden = values.find((v) => v.unknown);
  if (hidden)
    return hidden;
  if (name === "printf")
    return { value: printf(values.map((v) => v.value)) };
  let k = 0;
  while (k < values.length && /^-[neE]+$/.test(values[k].value))
    k++;
  return {
    value: `${values.slice(k).map((v) => decode(v.value)).join(" ")}
`
  };
}
function printf([format = "", ...args]) {
  const conversion = /%(?:%|[-+ #0']*(?:[1-9]\d*)?(?:\.\d+)?([a-zA-Z]))/g;
  const pattern = decode(format);
  let out = "";
  let k = 0;
  for (;; ) {
    tick();
    const before = k;
    out += pattern.replace(conversion, (_, kind) => {
      if (!kind)
        return "%";
      const value = args[k++] ?? "";
      return kind === "b" ? decode(value) : value;
    });
    if (k === before || k >= args.length)
      return out;
  }
}
async function stdinOf(cmd, env) {
  tick();
  return held2(await stdinText(cmd, env));
}
async function stdinText(cmd, env) {
  const input = cmd.redirects.findLast((r) => (r.fd === "" || r.fd === "0") && r.op.startsWith("<") && r.op !== "<&");
  if (input?.target?.procs)
    return outputs(input.target.procs, env);
  if (input?.op === "<" || input?.op === "<>")
    return input.target ? readPath(input.target, env) : unknown("an input redirect");
  if (input)
    return input.body ? resolveText(input.body, env) : unknown("a heredoc the hook could not read");
  if (cmd.stdin)
    return outputOf(cmd.stdin, env);
  return unknown("stdin the hook cannot see");
}
async function resolveText(text, env) {
  if (text.unknown || !text.reads?.length)
    return text;
  const pieces = text.value.split(READ);
  let value = pieces[0];
  for (const [k, path] of text.reads.entries()) {
    tick();
    const file = await readPath(path, env);
    if (file.unknown)
      return file;
    if (k + 1 < pieces.length)
      value += file.value + pieces[k + 1];
    if (value.length > MAX_BYTES)
      return unknown(LARGE);
  }
  for (const piece of pieces.slice(text.reads.length + 1))
    value += READ + piece;
  return { value };
}
function pathOf(text, env) {
  if (text.unknown || text.reads?.length || text.value === "")
    return;
  if (isAbsolute(text.value))
    return text.value;
  return env.cwd ? resolve2(env.cwd, text.value) : undefined;
}
async function readFile(path) {
  const file = Bun.file(path);
  try {
    const stats = await file.stat();
    if (!stats.isFile())
      return unknown(`${path}, which is not a regular file`);
    if (stats.size > MAX_BYTES)
      return unknown(`${path}, which is too large to read`);
    return { value: await file.text() };
  } catch (error) {
    if (error.code === "ENOENT")
      return;
    return unknown(`${path}, which the hook cannot read`);
  }
}
async function readPath(path, env) {
  const resolved = pathOf(path, env);
  if (!resolved && path.unknown)
    return unknown(`a file path built from ${path.unknown}, which the hook cannot expand: name the file by its literal absolute path`);
  if (!resolved)
    return unknown("a file path the hook cannot resolve");
  return env.files.get(resolved) ?? await readFile(resolved) ?? unknown(`${resolved}, which does not exist yet`);
}
function knownVariables(command, environment, cwd) {
  const values = {
    HOME: environment.HOME,
    PWD: /\b(?:cd|popd|pushd)\b/.test(command) ? undefined : cwd,
    TMPDIR: environment.TMPDIR
  };
  const known = {};
  for (const [name, value] of Object.entries(values)) {
    if (value && !command.includes(`${name}=`))
      known[name] = value;
  }
  return known;
}

// scripts/hooks/no-main-checkout.ts
function real(path) {
  const found = resolved(path);
  if (found !== undefined || !isAbsolute2(path))
    return found ?? nearest(path);
  const parts = normalize(path).split(sep).filter(Boolean);
  let low = 0;
  let high = parts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (resolved(sep + parts.slice(0, mid).join(sep)) === undefined)
      high = mid - 1;
    else
      low = mid;
  }
  return join5(resolved(sep + parts.slice(0, low).join(sep)) ?? sep, ...parts.slice(low));
}
var resolved = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return;
  }
};
function nearest(path) {
  const rest = [];
  for (let dir = path;; dir = dirname(dir)) {
    const found = resolved(dir);
    if (found !== undefined)
      return join5(found, ...rest.reverse());
    if (dir === dirname(dir))
      return path;
    rest.push(basename2(dir));
  }
}
var FILE_TOOLS = {
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
  Write: "file_path"
};
var BUN_SCRIPTS = new Set(["build", "check-types", "test", "test:file"]);
var RUNNERS = new Set(["npx"]);
var TOOLS = new Set(["lefthook", "turbo"]);
function bunCall(args, env) {
  let cwd = env.cwd;
  let filtered = false;
  const words = [];
  let k = 0;
  for (;k < args.length; k++) {
    const v = args[k].value;
    if (v === "--cwd")
      cwd = args[k + 1] && pathOf(args[++k], env);
    else if (v.startsWith("--cwd="))
      cwd = pathOf({ ...args[k], value: v.slice(6) }, env);
    else if (v === "--filter" || v === "-F") {
      filtered = true;
      k++;
    } else if (v.startsWith("--filter="))
      filtered = true;
    else if (!v.startsWith("-")) {
      words.push(v);
      if (v !== "run" && v !== "x")
        break;
    }
  }
  return { at: k, cwd, filtered, words };
}
function gitCall(args, env) {
  let cwd = env.cwd;
  let gitDir;
  let workTree;
  const value = (k, flag) => args[k].value === flag ? args[k + 1] : { ...args[k], value: args[k].value.slice(flag.length + 1) };
  let k = 0;
  for (;k < args.length && args[k].value.startsWith("-"); k++) {
    const v = args[k].value;
    if (v === "-C")
      cwd = args[k + 1] && pathOf(args[++k], { ...env, cwd });
    else if (v === "--git-dir" || v.startsWith("--git-dir=")) {
      const word = value(k, "--git-dir");
      if (v === "--git-dir")
        k++;
      gitDir = word && pathOf(word, { ...env, cwd });
    } else if (v === "--work-tree" || v.startsWith("--work-tree=")) {
      const word = value(k, "--work-tree");
      if (v === "--work-tree")
        k++;
      workTree = word && pathOf(word, { ...env, cwd });
    } else if (GIT_TAKES.has(v))
      k++;
  }
  const repo = gitDir?.replace(/\/+$/, "");
  const tree = repo?.endsWith(`${sep}.git`) ? dirname(repo) : workTree ?? cwd;
  return { cwd: tree, rest: args.slice(k + 1).map((a) => a.value), sub: args[k]?.value };
}
var GIT_MOVES = new Set([
  "am",
  "bisect",
  "checkout",
  "cherry-pick",
  "mv",
  "pull",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "switch",
  "update-ref"
]);
var APPLY_READS = new Set(["--check", "--numstat", "--stat", "--summary"]);
var RUNNER_TAKES = new Set(["--package", "-p"]);
var SED_VALUES = new Set(["--expression", "--file", "--line-length"]);
if (false) {}

// scripts/hooks/no-extensions-write.ts
var ROUTE = "every guard reads its list and policy.json from there, so a session's write would change what a guard allows. A guard's list or setting changes only by the owner typing the playground command as a ! command in the dispatcher's terminal window, which runs without hooks: tell your lead, and the dispatcher hands the owner the command. A session writes nothing there by hand.";
var refuse = (what) => `no-extensions-write hook refuses ${what}: ${ROUTE}`;
var TOO_LONG = "a command too long or nested too deep to read inside the hook's time: split it into shorter calls";
var READERS = new Set([
  "[",
  "cat",
  "cmp",
  "diff",
  "grep",
  "head",
  "jq",
  "ls",
  "readlink",
  "realpath",
  "shasum",
  "stat",
  "tail",
  "test",
  "wc"
]);
var FIND_ACTS = /^-(?:delete|exec|execdir|fls|fprint|fprint0|fprintf|ok|okdir)$/;
var GIT_READS = new Set([
  "blame",
  "cat-file",
  "diff",
  "grep",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status"
]);
var EXPORTS2 = new Set(["declare", "export", "local", "readonly", "typeset"]);
var REMOVERS = new Set(["find", "mv", "rm", "rmdir", "rsync", "unlink"]);
var DUPLICATE = /^(?:\d+|-)$/;
var writer = ({ op, target }) => [">", ">>", ">|", "<>"].includes(op) || op === ">&" && !DUPLICATE.test(target?.value ?? "");
var GLOB = /[*?[{(]/;
var RUNS = /^(?:EDITOR|GIT_[A-Z_]+|LESSOPEN|PAGER|VISUAL)$/;
var CLI = join6("packages", "scripts", "src", "playground", "cli.ts");
var varsRun = new WeakMap;
function runsVariable(vars) {
  const [cursor, found] = varsRun.get(vars) ?? [undefined, false];
  const [keys, next] = varsSince(vars, cursor);
  const now = found || keys.some((key) => RUNS.test(key));
  varsRun.set(vars, [next, now]);
  return now;
}
function reads(parsed, env) {
  const { args, local, name } = parsed;
  if ([...local.keys()].some((key) => RUNS.test(key)) || runsVariable(env.vars))
    return false;
  if (READERS.has(name) || PRINTERS.has(name))
    return true;
  if (name === "rg")
    return !args.some((a) => /^--(?:hostname-bin|pre)(?:=|$)/.test(a.value));
  if (name === "find")
    return !args.some((a) => FIND_ACTS.test(a.value));
  if (name !== "git")
    return false;
  const { rest, sub } = gitCall(args, env);
  const before = args.slice(0, args.length - rest.length - 1).map((a) => a.value);
  return !!sub && GIT_READS.has(sub) && !before.some((w) => w === "-c" || /^--(?:config-env|exec-path)/.test(w)) && !rest.some((w) => /^(?:--output|-O|--open-files-in-pager|--ext-diff|--textconv)/.test(w));
}
var GUARD_KEYS = new Set([
  "ext.links",
  "ext.order",
  "ext.repos",
  "factory.archiveRepo",
  "factory.publicRepo",
  "glm.readOnlyLoad5",
  "live.branch",
  "owner.names",
  "paths.codeRoot",
  "sessions.aliases",
  "sessions.names",
  "usage.keychainService"
]);
var EXT_WRITES = new Set(["add", "import", "init", "link", "order", "remove", "sync", "unlink"]);
var EXT_DRY = new Set(["add", "import", "init"]);
var SWITCHES = {
  ext: ["--dry-run", "--yes"],
  settings: ["--dry-run"]
};
function isCli(word, dirs) {
  tick();
  if (marked(word.value) || word.value.startsWith("-"))
    return false;
  const paths = dirs.map((dir) => pathOf(word, { cwd: dir }));
  if (program(word.value).toLowerCase() === "playground")
    return !word.value.includes("/") || !paths.some((path) => !!path && existsSync(path) && statSync(path).isDirectory());
  const cli = (sep2 + CLI).toLowerCase();
  return paths.some((path) => !!path && [path, `${path}.ts`].some((at) => real(at).toLowerCase().endsWith(cli)));
}
function cliCalls(parsed, env) {
  const { args, first, name } = parsed;
  if (!first)
    return [];
  const words = [first, ...args];
  const dirs = [env.cwd, name === "bun" ? bunCall(args, env).cwd : undefined];
  return words.flatMap((word, at) => isCli(word, dirs) ? [words.slice(at + 1)] : []);
}
var IDENTITY = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CONFIG_DIR", "PLAYGROUND_ROLE"];
var SETS = /^(?:CLAUDE_CODE_SESSION_ID|CLAUDE_CONFIG_DIR|PLAYGROUND_ROLE)\+?=/;
var CLEARS = /^(?:-[^-\s]*i|--ignore-environment$|-$)/;
var SCORE = /\bext\s+score\b/;
var unquoted = (text) => text.replace(/\\\n|\$(?=["'])|["'\\]/g, "");
var SCORE_AS_OTHER = `playground ext score on a line that clears or sets ${IDENTITY.join(", ")}, which reads as another author than the calling session`;
var changes = (words) => words.some((w) => SETS.test(w.value)) || words.some((w) => program(w.value) === "env") && words.some((w) => CLEARS.test(w.value) || IDENTITY.some((k) => w.value.includes(k)));
function changesIdentity(commands) {
  return commands.some((cmd) => changes(cmd.words) || !!cmd.inner && changesIdentity(cmd.inner()) || [...cmd.words, ...cmd.redirects.flatMap((r) => r.target ? [r.target] : [])].some((word) => !!word.procs && changesIdentity(word.procs)));
}
function scoreAsOther(words, cmd, parsed, env) {
  if (words[0]?.value !== "ext" || words[1]?.value !== "score")
    return false;
  if (IDENTITY.some((k) => parsed.local.has(k) || env.vars.has(k)))
    return true;
  const all = parsed.first ? [parsed.first, ...parsed.args] : parsed.args;
  const at = cmd.words.indexOf(all[all.length - words.length - 1]);
  return changes(at === -1 ? cmd.words : cmd.words.slice(0, at));
}
var AWKS = new Set(["awk", "gawk", "mawk", "nawk"]);
var AWK_RUNS = /system|getline|[|>@]/;
function awkPrograms(words) {
  const programs = [];
  for (let k = 0;k < words.length; k++) {
    const { value } = words[k];
    if (value === "--")
      return programs.length ? programs : words.slice(k + 1, k + 2);
    if (/^-[Fv]$/.test(value))
      k++;
    else if (/^-[Fv]./.test(value))
      continue;
    else if (value === "-e" || value === "--source")
      programs.push(words[++k] ?? { value: "" });
    else if (value.startsWith("--source="))
      programs.push({ ...words[k], value: value.slice(9) });
    else if (value.startsWith("-"))
      return;
    else
      return programs.length ? programs : [words[k]];
  }
  return programs.length ? programs : undefined;
}
function programLines({ args, first }, rooted) {
  if (!AWKS.has(program(first?.value ?? "").toLowerCase()))
    return [];
  return (awkPrograms(args) ?? []).filter(({ value }) => rooted || AWK_RUNS.test(value)).flatMap(({ value }) => [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]));
}
function ownProgram(cmd, { first, name }) {
  return ownFirst(cmd, first) && !marked(name) && /^(?:\/(?:bin|opt\/homebrew\/bin|usr\/bin|usr\/local\/bin)\/)?[^/]+$/.test(first.value);
}
function narrow(cmd, env) {
  const parsed = parse(cmd);
  const { args, first } = parsed;
  if (!first) {
    return onlyReserved(cmd) && cmd.redirects.length === 0 && !cmd.inner && !cmd.group && parsed.local.size === 0;
  }
  if (!ownProgram(cmd, parsed))
    return false;
  const base = program(first.value).toLowerCase();
  if (AWKS.has(base)) {
    const programs = awkPrograms(args);
    return !!programs && programs.every(({ value }) => !marked(value) && !AWK_RUNS.test(value));
  }
  if (["cat", "grep", "head", "tail", "wc"].includes(base))
    return reads(parsed, env);
  if (base === "cut")
    return true;
  if (base === "sort")
    return !args.some(({ value }) => /^-[a-zA-Z]*o|^--./.test(value));
  if (base === "uniq")
    return args.filter(({ value }) => value === "-" || !value.startsWith("-")).length <= 1;
  return false;
}
function rooted(commands) {
  return commands.some((cmd) => !!stdinShell(cmd) || !!cmd.inner && rooted(cmd.inner()) || [...cmd.words, ...cmd.redirects.flatMap((r) => r.target ? [r.target] : [])].some((word) => !!word.procs && rooted(word.procs)));
}
function quietCommit(cmd, parsed, env) {
  const { args, local, name } = parsed;
  if (name !== "git" || local.size > 0 || !ownProgram(cmd, parsed))
    return false;
  const { rest, sub } = gitCall(args, env);
  if (sub !== "commit")
    return false;
  const before = args.slice(0, args.length - rest.length - 1).map((a) => a.value);
  if (before.some((w) => w === "-c" || w === "-C" || /^--(?:config-env|exec-path|git-dir|work-tree)/.test(w)))
    return false;
  return args.every((word, at) => !/\s/.test(word.value) || word.quoted && !marked(word.value) && (/^(?:-[a-zA-Z]*m|--message)$/.test(args[at - 1]?.value ?? "") || word.value.startsWith("--message=")));
}
function wholeLine(commands, env) {
  return commands.some((cmd) => {
    const words = [...cmd.words, ...cmd.redirects.flatMap((r) => r.target ? [r.target] : [])];
    if (words.some((word) => word.procs && wholeLine(word.procs, env)))
      return true;
    const writes = cmd.redirects.some((r) => writer(r) && r.target?.value !== "/dev/null");
    return writes || !(narrow(cmd, env) || quietCommit(cmd, parse(cmd), env));
  });
}
function runsOf(parsed, vars, whole, rootLine) {
  const { args, first, local } = parsed;
  const values = [...local.values(), ...vars].flatMap((text) => text.unknown ? [] : [text.value]);
  for (const word of whole ? first ? [first, ...args] : args : [])
    for (const text of texts(word)) {
      values.push(text.value.replace(/^!/, ""));
      if (rootLine)
        values.push(...text.value.split("\\n"));
    }
  values.push(...programLines(parsed, rootLine));
  return [...new Set(values)].filter((value) => /\s/.test(value) && !marked(value));
}
function cliWrite(words) {
  const [command, verb, ...rest] = words.map((w) => marked(w.value) ? undefined : w.value);
  if (command === undefined)
    return words.length ? "playground with a command word it cannot read" : undefined;
  if (command === "migrate")
    return "playground migrate, which seeds the lists and settings";
  if (command === "uninstall")
    return words.some((w) => w.value === "--purge") ? "playground uninstall --purge, which moves the data folder aside" : undefined;
  const switches = SWITCHES[command];
  if (!switches)
    return;
  if (verb === undefined)
    return `playground ${command} with a verb it cannot read`;
  const unread = rest.includes(undefined);
  const positional = [];
  let dry = false;
  for (let k = 0;k < rest.length; k++) {
    const word = rest[k];
    if (word !== undefined && switches.includes(word))
      dry ||= word === "--dry-run";
    else if (word?.startsWith("--"))
      k++;
    else
      positional.push(word);
  }
  if (command === "settings") {
    if (verb !== "set" && verb !== "reset")
      return;
    const key = positional[0];
    if (unread || key === undefined)
      return `playground settings ${verb} with a word it cannot read`;
    return GUARD_KEYS.has(key) ? `playground settings ${verb} of ${key}, a key a guard reads` : undefined;
  }
  if (verb === "accept")
    return "playground ext accept, the owner's own call, which the owner runs as `! env -u PLAYGROUND_ROLE playground ext accept \u2026` in the dispatcher's terminal window, since the CLI refuses an accept with PLAYGROUND_ROLE set and that window carries one";
  if (verb === "put")
    return unread || positional[1] === "list" ? "playground ext put of a list, or with a word it cannot read, which may render into a guard's list" : undefined;
  if (EXT_WRITES.has(verb) && !(dry && EXT_DRY.has(verb)))
    return `playground ext ${verb}, which changes what the guards' lists and policy.json render from`;
}
var texts = (word) => {
  const v = word.value;
  const out = [word];
  const eq = v.indexOf("=");
  if (eq > 0)
    out.push({ ...word, value: v.slice(eq + 1) });
  if (/^-[A-Za-z]./.test(v))
    out.push({ ...word, value: v.slice(2) });
  return out;
};
function inspect(raw, environment) {
  const { cwd, tool_input: toolInput, tool_name: tool } = JSON.parse(raw);
  const input = toolInput ?? {};
  const directory = typeof cwd === "string" ? cwd : undefined;
  const root = real(extensionsDir(dataDir(environment)));
  const home = environment.HOME || homedir4();
  const needle = root.startsWith(real(home) + sep2) ? root.slice(real(home).length) : root;
  const inRoot = (path) => {
    if (path === undefined)
      return false;
    const at = real(path);
    return at === root || at.startsWith(root + sep2);
  };
  const above = (path, remover) => {
    if (path === undefined)
      return false;
    const at = real(path);
    return at === sep2 ? remover : root.startsWith(at + sep2);
  };
  const file = typeof tool === "string" ? input[FILE_TOOLS[tool]] : undefined;
  if (typeof file === "string") {
    const expanded = /^~(?:\/|$)/.test(file) ? join6(home, file.slice(1)) : file;
    return inRoot(resolve4(directory ?? "", expanded)) ? refuse(`a write to ${file}`) : undefined;
  }
  if (tool !== "Bash")
    return;
  const { command } = input;
  if (typeof command !== "string")
    return;
  if (command.length > 131072)
    return refuse(TOO_LONG);
  const relative = (env) => env.cwd && above(env.cwd, false) ? root.slice(real(env.cwd).length + 1) : undefined;
  const holds = (value, env) => {
    const near = relative(env);
    return value.includes(needle) || !!near && value.includes(near);
  };
  const judged = new Map;
  const names = (word, env, remover, literal = false) => {
    const quotedGlob = literal && !word.glob;
    const key = `${remover}\x00${quotedGlob}\x00${env.cwd}\x00${word.value}`;
    if (!judged.has(key))
      judged.set(key, judge(word, env, remover, quotedGlob));
    return judged.get(key);
  };
  const judge = (word, env, remover, quotedGlob) => {
    tick();
    for (const text of texts(word)) {
      if (holds(text.value, env))
        return `${root} in its text`;
      const path = pathOf(text, env);
      if (inRoot(path))
        return path;
      if (above(path, remover))
        return `${path}, which holds ${root}`;
      const glob = GLOB.exec(text.value);
      if (glob && !quotedGlob && !marked(text.value)) {
        const dir = pathOf({ value: `${text.value.slice(0, glob.index)}x` }, env);
        const folder = dir && dirname2(dir);
        if (folder && (inRoot(folder) || above(folder, true)))
          return `${text.value}, a glob in ${folder}`;
      }
    }
  };
  const seen = new Set;
  let whole = false;
  let rootLine = false;
  const varsRead = new WeakMap;
  const varsJudged = new WeakMap;
  const since = (store, vars, key) => {
    const cursors = store.get(vars) ?? new Map;
    store.set(vars, cursors);
    const [keys, next] = varsSince(vars, cursors.get(key));
    cursors.set(key, next);
    return keys.flatMap((k) => vars.get(k) ?? []);
  };
  const visit = async (cmd, parsed, env) => {
    const slot = slotWords(parsed);
    if (slot)
      return slot.length === 0 ? undefined : examine({ ...cmd, words: slot }, env, visit, false);
    const { args, first, name, xargs } = parsed;
    const into = cmd.redirects.find((r) => r.target && writer(r) && (inRoot(pathOf(r.target, env)) || GLOB.test(r.target.value) && !!names(r.target, env, true)));
    if (into?.target)
      return refuse(`a write to ${pathOf(into.target, env)}`);
    const reader = !rootLine && ownFirst(cmd, first) && reads(parsed, env);
    const fed = xargs ? await stdinOf(cmd, env) : undefined;
    const stdinWords = !fed ? [] : fed.unknown ? [{ quoted: false, value: UNKNOWN }] : fed.value.split(/\s+/).filter(Boolean).map((value) => ({ quoted: false, value }));
    const calls = reader ? [] : cliCalls(parsed, env);
    const write = calls.map((words) => cliWrite(xargs?.replace ? words : [...words, ...stdinWords])).find(Boolean) ?? (calls.some((words) => scoreAsOther(words, cmd, parsed, env)) ? SCORE_AS_OTHER : undefined);
    if (write)
      return refuse(write);
    const vars = !reader && first ? since(varsRead, env.vars, "") : [];
    const script = [];
    if (stdinShell(cmd) === "root") {
      const text = await stdinOf(cmd, env);
      if (text.unknown || marked(text.value))
        return refuse(`a root shell whose script (${text.unknown ?? "a value it cannot read"}) the hook cannot read; run its commands as calls of their own, with no root shell`);
      script.push(text.value);
    }
    for (const raw of reader ? [] : [...script, ...runsOf(parsed, vars, whole, rootLine)]) {
      const line = xargs?.replace && fed ? filled(raw, xargs.replace, fed.unknown ? UNKNOWN : fed.value) : raw;
      if (seen.has(line))
        continue;
      seen.add(line);
      const verdict = await run(lex(line, env.known), { ...env, vars: new Map }, visit, true);
      if (verdict)
        return verdict;
    }
    const quiet = !whole && quietCommit(cmd, parsed, env);
    for (const word of quiet ? args : []) {
      if (!/\s/.test(word.value))
        continue;
      const named = lex(word.value.replace(/^--message=/, ""), env.known).commands.flatMap((c) => cliCalls(parse(c), env)).map((words) => cliWrite(words)).find(Boolean);
      if (named)
        return refuse(named);
    }
    if (!first || EXPORTS2.has(name) || reader)
      return;
    const verb = name && !marked(name) ? name : "a program it cannot read";
    if (inRoot(env.cwd))
      return refuse(`${verb} run inside ${root}`);
    if (name === "git" && inRoot(gitCall(args, env).cwd))
      return refuse(`git on a clone in ${root}`);
    const remover = REMOVERS.has(name);
    const scope = since(varsJudged, env.vars, `${env.cwd}\x00${remover}`);
    for (const value of [...parsed.local.values(), ...scope]) {
      const named = names({ ...value, quoted: false }, env, remover);
      if (named)
        return refuse(`${verb} with a variable on ${named}`);
    }
    const literal = !whole && narrow(cmd, env);
    for (const word of [first, ...args]) {
      if (quiet && /\s/.test(word.value) && !texts(word).some((t) => holds(t.value, env)))
        continue;
      const named = names(word, env, remover, literal);
      if (named)
        return refuse(`${verb} on ${named}`);
    }
    if (cmd.redirects.some((r) => r.body && holds(r.body.value, env)))
      return refuse(`${verb} with a script that names ${root}`);
    if (fed) {
      const named = !fed.unknown && fed.value.split(/\s+/).filter(Boolean).map((value) => names({ quoted: false, value }, env, remover)).find(Boolean);
      if (named)
        return refuse(`${verb} under xargs on ${named}`);
    }
  };
  const known = knownVariables(command, environment, directory);
  const lexed = lex(command, known);
  const env = {
    cwd: directory,
    files: new Map,
    known,
    old: { dir: directory },
    process: environment,
    vars: new Map
  };
  rootLine = rooted(lexed.commands);
  whole = rootLine || wholeLine(lexed.commands, env);
  if (SCORE.test(unquoted(command)) && changesIdentity(lexed.commands))
    return refuse(SCORE_AS_OTHER);
  return run(lexed, env, visit, true);
}
async function check(raw, environment = process.env, budget = 1e4) {
  try {
    return await withDeadline(budget, async () => inspect(raw, environment));
  } catch (error) {
    if (error instanceof RangeError)
      return refuse(TOO_LONG);
  }
}
async function guarded(raw, environment = process.env, wait = 12000, url = new URL(`./no-extensions-write-worker.${import.meta.path.endsWith(".js") ? "js" : "ts"}`, import.meta.url).href) {
  const worker = new Worker(url);
  let timer;
  try {
    return await Promise.race([
      new Promise((done) => {
        worker.onmessage = (event) => done(event.data);
        worker.onerror = () => done(undefined);
        worker.postMessage({ environment, raw });
      }),
      new Promise((done) => {
        timer = setTimeout(() => done(refuse(TOO_LONG)), wait);
      })
    ]);
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}
if (import.meta.main) {
  const raw = await Bun.stdin.text();
  const reason = await fromFactory(raw) ? await guarded(raw) : undefined;
  if (reason) {
    console.error(reason);
    process.exit(2);
  }
}
export {
  GUARD_KEYS,
  check,
  guarded
};
