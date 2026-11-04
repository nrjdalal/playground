// @bun
const __CHECKOUT = import.meta.dir.slice(0, import.meta.dir.lastIndexOf("/scripts/hooks/bundled"));

// scripts/hooks/no-main-checkout.ts
import { readFileSync, realpathSync } from "fs";
import { basename as basename2, dirname as dirname2, isAbsolute as isAbsolute2, join as join4, normalize, resolve as resolve3, sep } from "path";

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

// packages/env/src/data-dir.ts
import { homedir } from "os";
import { join, resolve } from "path";
var dataDirOf = (env, home = env.HOME || homedir()) => env.PLAYGROUND_DATA_DIR ? resolve(env.PLAYGROUND_DATA_DIR) : join(home, ".playground");

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

// scripts/hooks/shell.ts
import { homedir as homedir3 } from "os";
import { basename, dirname, isAbsolute, resolve as resolve2 } from "path";
var UNKNOWN = "\x00";
var READ = "\x01";
var MAX_BYTES = 1048576;
var MAX_SCRIPT = 131072;
var LARGE = "a text too large to read";
var deadline;
var steps = 0;
function tick() {
  if (++steps % 1024 !== 0 || deadline === undefined)
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
var OPENS = new Set(["case", "coproc", "for", "if", "select", "until", "while", "{"]);
var CLOSES = new Set(["done", "esac", "fi", "}"]);
var HELD = new Set(["coproc", "function", "{"]);
var FREES = new Set([`
`, ";", ";;", "&", "||"]);
var tokens = 0;
var freshToken = () => ++tokens;
var BODIES = new Set(["do", "elif", "else", "then"]);
var MARKERS = new Set([...RESERVED, ...OPENS, ...CLOSES, ...BODIES]);
function markers(words) {
  const out = [];
  for (let k = 0;k < words.length; ) {
    const w = words[k];
    if (w.quoted)
      break;
    if (w.value === "function") {
      out.push("function");
      k += 2;
    } else if (MARKERS.has(w.value)) {
      out.push(w.value);
      k++;
    } else if (ASSIGN.test(w.value))
      k++;
    else
      break;
  }
  return out;
}
var ownFirst = (cmd, first) => !!first && first === cmd.words.find((w) => w.quoted || !RESERVED.has(w.value));
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
  const firstWrapper = before.find((w) => !w.quoted && ROOT_SHELLS.has(program(w.value)));
  const wrappers = [];
  for (const w of before) {
    if (wrappers.some((wrapper) => startsRootShell(wrapper, w.value)))
      return "root";
    if (w === firstWrapper || ROOT_SHELLS.has(w.value))
      wrappers.push(program(w.value));
  }
  return first && wrappers.length ? "root" : undefined;
}
function startsRootShell(wrapper, value) {
  if (marked(value))
    return true;
  const shells = ROOT_SHELLS.get(wrapper);
  const { flags, values } = WRAPPERS.get(wrapper);
  if (value.startsWith("--")) {
    const named = [...flags, ...values].filter((o) => o.startsWith(value));
    return shells.has(named.length === 1 ? named[0] : value);
  }
  if (!/^-[A-Za-z]/.test(value))
    return false;
  let shell = false;
  for (const c of value.slice(1)) {
    if (values.has(`-${c}`))
      return shell;
    if (!flags.has(`-${c}`))
      return false;
    shell ||= shells.has(`-${c}`);
  }
  return shell;
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
var merge = (out, part) => {
  out.value += part.value;
  if (part.unknown)
    out.unknown ??= part.unknown;
  if (part.variable)
    out.variable ??= part.variable;
  if (part.reads?.length)
    (out.reads ??= []).push(...part.reads);
};
var join3 = (parts, separator = "") => {
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
    tick();
    const point = hex || u4 || u8 ? Number.parseInt(hex ?? u4 ?? u8 ?? "", 16) : Number.parseInt(octal ?? "", 8);
    if (!Number.isNaN(point))
      return point <= 1114111 ? String.fromCodePoint(point) : whole;
    return ESCAPES[other ?? ""] ?? whole;
  });
}
function lex(src, known = {}) {
  const lx = { commands: [], i: 0, known, scope: 0, scopes: [-1], src, token: freshToken() };
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
  let depth = 0;
  let loops = 0;
  let after = "";
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
      const reserved = markers(done.words);
      const opened = reserved.filter((w) => OPENS.has(w)).length;
      const closed = reserved.filter((w) => CLOSES.has(w)).length;
      const body = reserved.some((w) => HELD.has(w) || BODIES.has(w));
      const loop = reserved.includes("do");
      if (after === "||" || depth > 0 || body)
        done.unsure = true;
      if (after === "&&")
        done.chained = true;
      done.chain = lx.token;
      if (reserved.some((w) => HELD.has(w)))
        done.held = true;
      if (loops > 0 || loop)
        done.repeated = true;
      depth = Math.max(0, depth + opened - closed);
      loops = Math.max(0, loops + (loop ? 1 : 0) - (reserved.includes("done") ? 1 : 0));
      if (depth === 0 && FREES.has(op))
        lx.token = freshToken();
      after = op;
      for (const w of done.words) {
        if (w.value !== "{" || w.quoted)
          break;
        opens.push(lx.commands.length);
      }
      lx.commands.push(done);
    }
    cmd = fresh();
    cmd.follows = op;
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
      end(")");
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
  if (marked(out.value))
    out.raw = src.slice(start, lx.i);
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
    return substituted(lx.commands.slice(from), lx.known);
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
  if (next === "$") {
    lx.i += 2;
    return { value: "99999" };
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
function substituted(inner, known) {
  const [only] = inner;
  if (inner.length !== 1 || only.stdin || only.group)
    return unknown("a command substitution");
  const made = mktempPath(only, known);
  if (made)
    return { value: made };
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
var MKTEMP_FLAGS = new Set(["d", "q"]);
var MKTEMP_LONG = new Set(["--directory", "--quiet"]);
function mktempPath(cmd, known) {
  const [first, ...args] = cmd.words;
  if (!first || first.quoted || first.value !== "mktemp" || cmd.redirects.length > 0)
    return;
  if (!known.TMPDIR)
    return;
  const flag = ({ quoted, value }) => !quoted && (MKTEMP_LONG.has(value) || /^-[a-z]+$/.test(value) && value.slice(1).split("").every((c) => MKTEMP_FLAGS.has(c)));
  const templates = args.filter((word) => !flag(word));
  const [template] = templates;
  if (templates.length > 1 || template?.value.startsWith("-") || marked(template?.value ?? ""))
    return;
  return template ? template.value : `${known.TMPDIR.replace(/\/$/, "")}/tmp.mktemp`;
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
    tick();
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
  unchain(cmd, env);
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
  const into = chdir && pathOf(chdir, env);
  const here = chdir ? {
    ...env,
    cwd: into,
    cwdHeld: [],
    cwdMaybe: [],
    cwdSure: into,
    cwdUnread: into === undefined
  } : env;
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
  } else if (name === "cd" || name === "popd" || name === "pushd") {
    if (name !== "popd" && args.some((a) => GLOB_CHARS.test(a.value)))
      verdict = await visit(cmd, parsed, here);
    await chdirTo(name, cmd, parsed, env);
  } else if (EXPORTS.has(name)) {
    for (const w of args.filter((a) => ASSIGN.test(a.value))) {
      const eq = w.value.indexOf("=");
      setVar(env.vars, w.value.slice(0, eq), slice(w, eq + 1));
    }
    if (builtins)
      verdict = await visit(cmd, parsed, here);
  } else if (SHELLS.has(name))
    verdict = await nested(cmd, env, () => shell(name, args, cmd, here, visit, builtins, parsed.xargs));
  else if ((name === "source" || name === ".") && (args[0]?.procs || args[0]?.value === "/dev/stdin")) {
    const script = await scriptOf(args[0], cmd, here);
    verdict = (script.unknown ? await visit(cmd, parsed, here) : undefined) ?? await nested(cmd, env, () => run(lexScript(known(script), env), here, visit, builtins));
  } else if (name === "eval") {
    verdict = await nested(cmd, env, () => run(lexScript(args.map((a) => a.value).join(" "), env), here, visit, builtins));
  } else
    verdict = await visit(cmd, parsed, here);
  await record(cmd, name, args, here);
  return verdict;
}
async function nested(cmd, env, body) {
  const chain = env.cwdChain;
  const token = env.cwdChainToken;
  env.cwdChain = [];
  env.cwdChainToken = undefined;
  try {
    return await body();
  } finally {
    const left = [...new Set([...chain ?? [], ...env.cwdChain ?? []])];
    env.cwdChain = keep(left, env);
    env.cwdChainToken = left.length > 0 ? chain?.length ? token : cmd.chain : undefined;
  }
}
var BUILTIN = new Set(["builtin", "command"]);
var sureToRun = (cmd, parsed) => !cmd.detached && !cmd.unsure && !cmd.repeated && (ownFirst(cmd, parsed.first) || throughBuiltin(cmd, parsed));
var throughBuiltin = (cmd, { first }) => {
  if (!first)
    return false;
  const before = cmd.words.slice(0, cmd.words.indexOf(first));
  return before.some((w) => !w.quoted && BUILTIN.has(program(w.value))) && before.every((w) => !w.quoted && (BUILTIN.has(program(w.value)) || w.value.startsWith("-") || MARKERS.has(w.value) || ASSIGN.test(w.value)));
};
var manyTimes = (cmd, { first }) => !!cmd.repeated || cmd.words.slice(0, first ? cmd.words.indexOf(first) : 0).some((w) => !w.quoted && COUNTED.has(program(w.value)));
var startFolders = (env) => [
  ...env.cwdSure === undefined ? [] : [env.cwdSure],
  ...env.cwdMaybe ?? []
];
function places(env, fallback) {
  const folders = [
    ...startFolders(env),
    ...env.cwdHeld ?? [],
    ...env.cwdUnread && fallback !== undefined ? [fallback] : []
  ];
  const out = [];
  const seen = new Set;
  for (const cwd of folders) {
    tick();
    if (seen.has(cwd))
      continue;
    seen.add(cwd);
    out.push({ ...env, cwd, cwdSure: cwd });
  }
  return out.length > 0 ? out : [{ ...env, cwd: undefined, cwdSure: undefined }];
}
function ancestors(path) {
  const out = [];
  for (let dir = dirname(path);; dir = dirname(dir)) {
    tick();
    out.push(dir);
    if (dir === dirname(dir))
      return out;
  }
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
  return await isFolder(path) ? path : undefined;
}
function cdTargets(name, cmd, parsed, env, from) {
  const dirs = parsed.args.filter((a) => !(a.value.startsWith("-") && a.value.length > 1));
  const [dir] = dirs;
  if (!dir) {
    return name === "cd" ? { paths: [homedir3()], unread: false } : { back: true, paths: [homedir3()], unread: true };
  }
  if (dir.value === "-")
    return { back: true, paths: [], unread: true };
  const paths = new Set;
  const many = manyTimes(cmd, parsed);
  let unread = dirs.length > 1;
  for (const word of dirs.length > 1 ? dirs : [dir]) {
    for (const base of from.length > 0 ? from : [undefined]) {
      tick();
      const path = pathOf(word, { ...env, cwd: base });
      if (path === undefined) {
        unread = true;
        continue;
      }
      paths.add(path);
      if (many && word.value.split("/").includes("..")) {
        for (const up of ancestors(path))
          paths.add(up);
      }
    }
  }
  return { back: dirs.length > 1, paths: [...paths], unread };
}
function pushdTilde(move, name, parsed, env, from, back) {
  const dir = parsed.args.find((a) => !(a.value.startsWith("-") && a.value.length > 1));
  const tilde = name === "pushd" && env.old && dir && !dir.quoted && !dir.unknown && !dir.reads?.length ? /^~([-+])(?=\/|$)/.exec(dir.value) : null;
  if (!tilde || !dir)
    return move;
  const bases = tilde[1] === "-" ? back : from;
  const paths = [
    ...move.paths,
    ...bases.map((base) => base + dir.value.slice(2)),
    ...env.cwd === undefined ? [] : [env.cwd]
  ];
  return {
    back: move.back || tilde[1] === "-",
    paths: [...new Set(paths)],
    unread: move.unread || bases.length === 0
  };
}
async function chdirTo(name, cmd, parsed, env) {
  const left = env.cwd;
  env.cwd = name === "popd" || cmd.detached ? undefined : await cdTarget(name, parsed.args, env);
  if (env.old)
    env.old = name === "popd" ? {} : { dir: env.cwd === undefined ? undefined : left };
  const from = startFolders(env);
  const back = [...new Set([...env.cwdBack ?? [], ...from])];
  const bases = [...new Set([...from, ...env.cwdHeld ?? []])];
  const move = name === "popd" ? { back: true, paths: [], unread: true } : pushdTilde(cdTargets(name, cmd, parsed, env, bases), name, parsed, env, from, back);
  const { paths, unread } = move;
  const named = [left, env.cwd].filter((dir) => dir !== undefined);
  env.cwdBack = keep([...new Set([...back, ...paths, ...named])], env);
  if (cmd.held) {
    env.cwdHeld = keep([...new Set([...env.cwdHeld ?? [], ...paths])], env);
    env.cwdUnread ||= unread;
    return;
  }
  const chained = cmd.chained && !negated(cmd);
  if (sureToRun(cmd, parsed) && !unread && paths.length === 1 && (chained || await isFolder(paths[0]))) {
    env.cwdSure = paths[0];
    env.cwdMaybe = [];
    env.cwdUnread = false;
    if (chained) {
      env.cwdChain = keep([...new Set([...env.cwdChain ?? [], ...from])], env);
      env.cwdChainToken = cmd.chain;
    }
    return;
  }
  env.cwdSure = undefined;
  env.cwdMaybe = keep([...new Set([...move.back ? back : from, ...paths])], env);
  env.cwdUnread = env.cwdUnread || unread || from.length === 0 && paths.length === 0;
}
var negated = (cmd) => markers(cmd.words).filter((word) => word === "!").length % 2 === 1;
function unchain(cmd, env) {
  if (!env.cwdChain?.length || cmd.chain === env.cwdChainToken)
    return;
  env.cwdMaybe = keep([...new Set([...env.cwdMaybe ?? [], ...env.cwdSure ? [env.cwdSure] : [], ...env.cwdChain])], env);
  env.cwdSure = undefined;
  env.cwdChain = [];
  env.cwdChainToken = undefined;
}
var MAX_FOLDERS = 32;
function keep(folders, env) {
  if (folders.length <= MAX_FOLDERS)
    return folders;
  env.cwdAnywhere = true;
  env.cwdSure = undefined;
  env.cwdUnread = true;
  return folders.slice(0, MAX_FOLDERS);
}
async function isFolder(path) {
  try {
    return (await Bun.file(path).stat()).isDirectory();
  } catch {
    return false;
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
  return join3(await Promise.all(cmds.map((c) => outputOf(c, env))));
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
    env.files.set(path, held2(r.op === ">>" ? join3([await existing(path, env), out]) : out));
  }
  if (name !== "tee")
    return;
  const input = await stdinOf(cmd, env);
  const append = args.some((a) => a.value === "-a" || a.value === "--append");
  for (const a of args) {
    const path = a.value.startsWith("-") ? undefined : pathOf(a, env);
    if (path)
      env.files.set(path, held2(append ? join3([await existing(path, env), input]) : input));
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
    return join3(parts);
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
function mainCheckout(dir) {
  try {
    const gitdir = /^gitdir: (.+)$/m.exec(readFileSync(join4(dir, ".git"), "utf8"))?.[1];
    const main = gitdir && /^(.+)\/\.git\/worktrees\/[^/]+$/.exec(resolve3(dir, gitdir.trim()))?.[1];
    if (main)
      return main;
  } catch {}
  return dir;
}
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
  return join4(resolved(sep + parts.slice(0, low).join(sep)) ?? sep, ...parts.slice(low));
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
  for (let dir = path;; dir = dirname2(dir)) {
    const found = resolved(dir);
    if (found !== undefined)
      return join4(found, ...rest.reverse());
    if (dir === dirname2(dir))
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
var INSTEAD = "the main checkout is what every installed skill follows, so it stays clean. Run it in your own worktree under .claude/worktrees/ (git worktree add --no-track .claude/worktrees/<name> -b <branch> origin/canary), or start lefthook from a script with cwd set to a scratch repo, as tests/lefthook.test.ts does.";
var refuse = (what, fix = INSTEAD) => `no-main-checkout hook refuses ${what}: ${fix}`;
var UNKNOWN_FIX = "the hook cannot tell which folder it runs in, since a cd before it may not run, may run many times, or names a path it cannot read, so it reads every folder the shell may be in. Name the folder instead: git -C <your worktree>, bun --cwd <your worktree>, or cd by a literal path.";
var ANYWHERE_FIX = "the line names more folders than the hook carries, so it cannot rule out the main checkout. Name the folder on the command instead: git -C <your worktree>, bun --cwd <your worktree>, or run it as a line of its own after a cd to a literal path.";
var fixFor = (sure, own = INSTEAD) => sure ? own : UNKNOWN_FIX;
var BUN_SCRIPTS = new Set(["build", "check-types", "test", "test:file"]);
var RUNNERS = new Set(["npx"]);
var X = { quoted: false, value: "x" };
var TOOLS = new Set(["lefthook", "turbo"]);
var DUPLICATE = /^(?:\d+|-)$/;
var PACKAGES_BUILD = ["run", "build", "--filter=./packages/*"];
var BUILD_FIX = "the main checkout has no .env, so the packages' env checks fail. Run it as playground update's build step types it, env NODE_ENV=production SKIP_ENV_VALIDATION=true <main checkout>/node_modules/.bin/turbo run build --filter='./packages/*' --cwd <main checkout>.";
function packagesBuild(args) {
  const words = [];
  for (let k = 0;k < args.length; k++) {
    const v = args[k].value;
    if (v === "--cwd")
      k++;
    else if (v === "--filter")
      words.push(`--filter=${args[++k]?.value}`);
    else if (!v.startsWith("--cwd="))
      words.push(v);
  }
  return words.length === PACKAGES_BUILD.length && words.every((w, i) => w === PACKAGES_BUILD[i]);
}
function cwdFlag(args, env) {
  let cwd = env.cwd;
  for (let k = 0;k < args.length; k++) {
    const v = args[k].value;
    if (v === "--cwd")
      cwd = args[k + 1] && pathOf(args[++k], env);
    else if (v.startsWith("--cwd="))
      cwd = pathOf({ ...args[k], value: v.slice(6) }, env);
  }
  return cwd;
}
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
  const tree = repo?.endsWith(`${sep}.git`) ? dirname2(repo) : workTree ?? cwd;
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
var STEP_FIVE = /^(?:-q |--quiet )?--ff-only (?:-q |--quiet )?origin\/main$/;
var GIT_FIX = "it moves the HEAD, index or files of the main checkout, which every installed skill, hook and ops job runs from. Name your own tree on every git call, git -C <your worktree> ..., after git -C <your worktree> rev-parse --show-toplevel names it; the main checkout moves only by the release skill's step 5, git -C <main checkout> fetch -q origin main && git -C <main checkout> merge --ff-only -q origin/main, a stray local commit on its main goes by git -C <main checkout> reset --keep origin/main while its tree is clean, and a worktree is made under .claude/worktrees/ by git worktree add --no-track .claude/worktrees/<name> -b <branch> origin/canary.";
function keepReset(sub, rest, cwd) {
  if (sub !== "reset" || rest.join(" ") !== "--keep origin/main" || !cwd)
    return false;
  const git = (...args) => {
    const read = Bun.spawnSync(["git", "-C", cwd, ...args], { stderr: "ignore", stdout: "pipe" });
    return read.exitCode === 0 ? read.stdout.toString() : undefined;
  };
  if (git("symbolic-ref", "-q", "HEAD")?.trim() !== "refs/heads/main")
    return false;
  if (git("status", "--porcelain") !== "")
    return false;
  const dropped = git("rev-list", "origin/main..main");
  return dropped !== undefined && dropped === git("rev-list", "origin/main..main", "--not", "--remotes");
}
function gitMoves(sub, rest) {
  if (GIT_MOVES.has(sub))
    return true;
  if (sub === "merge")
    return !STEP_FIVE.test(rest.join(" "));
  if (sub === "stash")
    return !["list", "show"].includes(rest[0] ?? "push");
  if (sub === "clean")
    return !rest.some((w) => w === "--dry-run" || /^-[a-z]*n/.test(w));
  if (sub === "add")
    return !rest.some((w) => w === "--dry-run" || /^-[a-zA-Z]*n/.test(w));
  if (sub === "apply")
    return rest.includes("--apply") || !rest.some((w) => APPLY_READS.has(w));
  if (sub === "branch")
    return rest.some((w) => w === "--force" || /^-[a-zA-Z]*f/.test(w));
  return false;
}
function turboWords(name, args, env) {
  if (name === "turbo")
    return args;
  if (RUNNERS.has(name) || name === "bunx") {
    const at = runnerTarget(args);
    return isTurbo(args[at]?.value) ? args.slice(at + 1) : undefined;
  }
  if (name !== "bun")
    return;
  const { at, words } = bunCall(args, env);
  const target = words[0] === "run" || words[0] === "x" ? words[1] : words[0];
  return isTurbo(target) ? args.slice(at + 1) : undefined;
}
var RUNNER_TAKES = new Set(["--package", "-p"]);
function runnerTarget(args) {
  let k = 0;
  while (k < args.length && args[k].value.startsWith("-"))
    k += RUNNER_TAKES.has(args[k].value) ? 2 : 1;
  return k;
}
var isTurbo = (word) => program((word ?? "").replace(/(?<=.)@[^/]*$/, "")) === "turbo";
function validationOff(local, env) {
  const read = (key) => local.get(key)?.value ?? env.vars.get(key)?.value ?? env.process[key];
  return !!read("NODE_ENV") && read("SKIP_ENV_VALIDATION") === "true";
}
function runs(name, args, local, env) {
  if (name === "bunx")
    return runs("bun", [X, ...args], local, env);
  const turbo = turboWords(name, args, env);
  if (turbo && packagesBuild(turbo)) {
    if (validationOff(local, env))
      return;
    return {
      cwd: cwdFlag(turbo, env),
      fix: BUILD_FIX,
      what: "the packages build without NODE_ENV and SKIP_ENV_VALIDATION=true"
    };
  }
  if (TOOLS.has(name))
    return { cwd: cwdFlag(args, env), what: name };
  if (RUNNERS.has(name) && TOOLS.has(program(args[0]?.value ?? ""))) {
    return { cwd: cwdFlag(args, env), what: `${name} ${program(args[0].value)}` };
  }
  if (name === "git") {
    const { cwd, rest, sub } = gitCall(args, env);
    if (sub === "commit")
      return { cwd, what: "git commit, which runs lefthook's pre-commit" };
    if (keepReset(sub, rest, cwd))
      return;
    return sub && gitMoves(sub, rest) ? { cwd, fix: GIT_FIX, what: `git ${sub}` } : undefined;
  }
  if (name !== "bun")
    return;
  const { at, cwd, filtered, words } = bunCall(args, env);
  const target = words[0] === "run" || words[0] === "x" ? words[1] : words[0];
  if (TOOLS.has(program(target ?? ""))) {
    const dir = words[0] === "x" ? env.cwd : cwd;
    return {
      cwd: cwdFlag(args.slice(at + 1), { ...env, cwd: dir }),
      what: `bun ${words.join(" ")}`
    };
  }
  if (words[0] === "test")
    return { cwd: cwdFlag(args.slice(at + 1), { ...env, cwd }), what: "bun test" };
  if (target && BUN_SCRIPTS.has(target) && (words[0] === "run" || filtered || target !== "build"))
    return { cwd, what: `bun ${words.join(" ")}` };
}
var LETTERS = {
  perl: {
    "0": "digits",
    C: "rest",
    D: "rest",
    E: "script",
    F: "rest",
    I: "rest",
    M: "rest",
    V: "rest",
    d: "rest",
    e: "script",
    i: "edit",
    l: "digits",
    m: "rest",
    x: "rest"
  },
  sed: { I: "edit", e: "script", f: "script", i: "edit", l: "value" }
};
var SED_VALUES = new Set(["--expression", "--file", "--line-length"]);
var BSD_SUFFIX = /^(\.[\w.-]*)?$/;
function inPlace(name, args) {
  const letters = LETTERS[name];
  if (!letters)
    return [];
  let edits = false;
  let scripted = false;
  const positionals = [];
  for (let k = 0;k < args.length; k++) {
    const v = args[k].value;
    if (v === "--") {
      positionals.push(...args.slice(k + 1));
      break;
    }
    if (name === "sed" && v.startsWith("--")) {
      const flag = v.split("=")[0];
      if (flag === "--in-place")
        edits = true;
      else if (SED_VALUES.has(flag)) {
        scripted ||= flag !== "--line-length";
        if (!v.includes("="))
          k++;
      }
    } else if (/^-[^-]/.test(v)) {
      for (let j = 1;j < v.length; j++) {
        const kind = letters[v[j]];
        const rest = v.slice(j + 1);
        if (kind === "digits")
          j += /^(x[0-9A-Fa-f]*|[0-7]*)/.exec(rest)[0].length;
        else if (kind === "edit") {
          edits = true;
          if (name === "sed" && rest === "" && BSD_SUFFIX.test(args[k + 1]?.value ?? "-"))
            k++;
          break;
        } else if (kind === "script" || kind === "value") {
          scripted ||= kind === "script";
          if (rest === "")
            k++;
          break;
        } else if (kind === "rest")
          break;
      }
    } else if (!v.startsWith("-"))
      positionals.push(args[k]);
  }
  if (!edits)
    return [];
  return scripted ? positionals : positionals.slice(1);
}
function writes(name, args) {
  const positionals = args.filter((a) => !a.value.startsWith("-"));
  if (name === "sed" || name === "perl")
    return inPlace(name, args);
  if (name === "touch" || name === "tee")
    return positionals;
  if (name === "cp" || name === "mv")
    return positionals.slice(-1);
  if (name !== "curl")
    return [];
  const out = [];
  for (let k = 0;k < args.length; k++) {
    const v = args[k].value;
    if (["-c", "--cookie-jar", "-o", "--output"].includes(v) && args[k + 1])
      out.push(args[++k]);
    const attached = /^--(?:cookie-jar|output)=(.+)$/.exec(v)?.[1];
    if (attached)
      out.push({ ...args[k], value: attached });
  }
  return out;
}
function writeTargets(cmd, name, args) {
  const targets = [
    ...cmd.redirects.filter((r) => [">", ">>", ">|"].includes(r.op) || r.op === ">&" && !DUPLICATE.test(r.target?.value ?? "")).flatMap((r) => r.target ? [r.target] : []),
    ...writes(name, args)
  ];
  return targets.filter((t) => !["-", "/dev/null"].includes(t.value));
}
async function unreadScript(shell, here, sure, inMain) {
  const script = await stdinOf(shell, here);
  if (!script.unknown || !inMain(here.cwd))
    return;
  return refuse(`a shell whose script (${script.unknown}) the hook cannot read`, fixFor(sure));
}
function inspect(raw, environment, main) {
  const { cwd, tool_input: toolInput, tool_name: tool } = JSON.parse(raw);
  const input = toolInput ?? {};
  const directory = typeof cwd === "string" ? cwd : undefined;
  const checkout = real(main);
  const worktrees = join4(checkout, ".claude", "worktrees") + sep;
  const inMain = (raw) => {
    const path = raw === undefined ? undefined : real(resolve3(directory ?? "", raw));
    return path !== undefined && (path === checkout || path.startsWith(checkout + sep)) && !(path + sep).startsWith(worktrees);
  };
  const file = typeof tool === "string" ? input[FILE_TOOLS[tool]] : undefined;
  if (typeof file === "string")
    return inMain(file) ? refuse(`a write to ${file}`) : undefined;
  if (tool !== "Bash")
    return;
  const { command } = input;
  if (typeof command !== "string")
    return;
  const known = knownVariables(command, environment, directory);
  const lexed = lex(command, known);
  const fed = new Map;
  for (const cmd of lexed.commands)
    if (cmd.stdin && stdinShell(cmd))
      fed.set(cmd.stdin, cmd);
  const visit = async (cmd, parsed, env) => {
    const slot = slotWords(parsed);
    if (slot)
      return slot.length === 0 ? undefined : examine({ ...cmd, words: slot }, env, visit, false);
    const { args, local, name } = parsed;
    if (env.cwdAnywhere) {
      const blind = { ...env, cwd: undefined };
      const ran = runs(name, args, local, blind);
      if (ran && (ran.cwd === undefined || inMain(ran.cwd)))
        return refuse(ran.what, ANYWHERE_FIX);
      const blindWrite = writeTargets(cmd, name, args).find((t) => {
        const path = pathOf(t, blind);
        return path === undefined || inMain(path);
      });
      if (blindWrite)
        return refuse(`a write to ${blindWrite.value}`, ANYWHERE_FIX);
    }
    for (const here of places(env, directory)) {
      const sure = env.cwdSure !== undefined && here.cwd === env.cwdSure;
      const pipedTo = fed.get(cmd);
      if (pipedTo) {
        const verdict = await unreadScript(pipedTo, here, sure, inMain);
        if (verdict)
          return verdict;
      }
      const ran = runs(name, args, local, here);
      if (ran && inMain(ran.cwd))
        return refuse(ran.what, fixFor(sure, ran.fix));
      const wrote = writeTargets(cmd, name, args).find((t) => inMain(pathOf(t, here)));
      if (wrote)
        return refuse(`a write to ${pathOf(wrote, here)}`, fixFor(sure));
    }
  };
  const env = {
    cwd: directory,
    cwdSure: directory,
    files: new Map,
    known,
    old: { dir: directory },
    process: environment,
    vars: new Map
  };
  return run(lexed, env, visit);
}
async function check(raw, environment = process.env, main = mainCheckout(resolve3(__CHECKOUT + "/scripts/hooks", "..", ".."))) {
  try {
    return await inspect(raw, environment, main);
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
  FILE_TOOLS,
  bunCall,
  check,
  cwdFlag,
  gitCall,
  mainCheckout,
  real,
  turboWords
};
