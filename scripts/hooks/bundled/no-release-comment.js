// @bun
const __CHECKOUT = import.meta.dir.slice(0, import.meta.dir.lastIndexOf("/scripts/hooks/bundled"));

// scripts/hooks/no-release-comment.ts
import { join as join4 } from "path";

// packages/settings/src/rendered.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
var CORE = "core";
var coreDir = () => fileURLToPath(new URL("../../../extensions/core", import.meta.url));
var extensionsDir = (data) => join(data, "extensions");
var markerPath = extensionsDir;
var fixFor = (file) => {
  const list = /^hooks\/(.+)\.json$/.exec(file)?.[1];
  if (list && !existsSync(join(coreDir(), "lists", `${list}.json`)))
    return `tell your lead, and the dispatcher hands the owner ! playground ext put <login> list ${list} <file> --reason <why> to type in the dispatcher's terminal window, which writes it, since core ships no such list`;
  return file.startsWith("hooks/") ? "tell your lead, and the dispatcher hands the owner ! playground ext import --from-tree extensions/core/lists to type in the dispatcher's terminal window, which seeds the guards' lists" : "tell your lead, and the dispatcher hands the owner ! playground ext init, then a setting with ! playground settings set, to type in the dispatcher's terminal window, which writes it";
};
var readRendered = async (data, file) => readRenderedSync(data, file);
var readRenderedSync = (data, file) => {
  const dir = extensionsDir(data);
  if (!existsSync(dir))
    return {};
  const parts = file.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    return { refusal: `${file} is not a path inside the extensions (${dir})` };
  const path = parts[0] === CORE ? join(coreDir(), ...parts.slice(1)) : join(dir, file);
  return existsSync(path) ? { path } : { refusal: `the extensions root (${dir}) holds no ${file}: ${fixFor(file)}` };
};

// scripts/hooks/github.ts
function repoOf(text) {
  if (text.unknown || text.reads?.length)
    return;
  const parts = text.value.trim().replace(/^[a-z][a-z\d+.-]*:\/\//i, "").split("/").filter(Boolean);
  const [owner, repo] = parts.length === 2 ? parts : parts.slice(1, 3);
  return owner && repo ? { owner, repo: repo.replace(/\.git$/, "") } : undefined;
}
function implicitRepos(env, local) {
  const fromEnv = local.get("GH_REPO") ?? env.vars.get("GH_REPO") ?? (env.process.GH_REPO ? { value: env.process.GH_REPO } : undefined);
  const candidates = fromEnv && fromEnv.value !== "" ? [repoOf(fromEnv)] : [];
  return [...candidates, ...remotes(env.cwd)];
}
function remoteRepo(url) {
  const path = /^(?:[a-z][a-z\d+.-]*:\/\/)?(?:[^@/]+@)?[^/:]+[:/](.+)$/i.exec(url.trim());
  const parts = path?.[1].split("/").filter(Boolean) ?? [];
  if (parts.length < 2)
    return;
  return { owner: parts[parts.length - 2], repo: parts[parts.length - 1].replace(/\.git$/, "") };
}
function remotes(cwd) {
  if (!cwd)
    return [];
  const git = Bun.spawnSync(["git", "-C", cwd, "config", "--get-regexp", "^remote\\..*\\.url$"], {
    stderr: "ignore"
  });
  if (git.exitCode !== 0)
    return [];
  return git.stdout.toString().split(`
`).flatMap((line) => {
    const repo = remoteRepo(line.slice(line.indexOf(" ") + 1));
    return repo ? [repo] : [];
  });
}

// scripts/hooks/lists.ts
import { existsSync as existsSync2 } from "fs";

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
import { join as join2, resolve } from "path";
var dataDirOf = (env, home = env.HOME || homedir()) => env.PLAYGROUND_DATA_DIR ? resolve(env.PLAYGROUND_DATA_DIR) : join2(home, ".playground");
var dataDir = (env = process.env) => dataDirOf(env);

// scripts/hooks/lists.ts
var storeMarker = (environment = process.env) => markerPath(dataDir(environment));
async function guardList(guard, name, valid, empty, environment = process.env, file) {
  const read = await readRendered(dataDir(environment), `hooks/${name}.json`);
  if (read.refusal)
    return { refusal: `${guard} hook refused this call: ${read.refusal}, then run the call again.` };
  const path = read.path ?? file;
  return path ? loadList(guard, path, valid, empty, environment) : { list: empty };
}
async function loadList(guard, path, valid, empty, environment = process.env) {
  const refuse = (what) => ({
    refusal: `${guard} hook refused this call: its list ${path} ${what}, so it cannot check the call. Restore the file (git checkout -- it, in the checkout that holds it) or fix it, then run the call again.`
  });
  if (!existsSync2(path))
    return existsSync2(storeMarker(environment)) ? refuse(`is missing on a machine with a store (${storeMarker(environment)})`) : { list: empty };
  let value;
  try {
    value = JSON.parse(await Bun.file(path).text());
  } catch (error) {
    return refuse(`is not JSON (${error})`);
  }
  return valid(value) ? { list: value } : refuse("lacks a key or holds a value of the wrong type");
}
var isStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

// scripts/hooks/shell.ts
import { homedir as homedir2 } from "os";
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
var held = (text) => text.value.length > MAX_BYTES ? unknown(LARGE) : text;
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
var visible = (value) => value.replaceAll(UNKNOWN, " ").replaceAll(READ, " ");
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
      out.value += homedir2();
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
    return homedir2();
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
    return name === "cd" ? { paths: [homedir2()], unread: false } : { back: true, paths: [homedir2()], unread: true };
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
    env.files.set(path, held(r.op === ">>" ? join3([await existing(path, env), out]) : out));
  }
  if (name !== "tee")
    return;
  const input = await stdinOf(cmd, env);
  const append = args.some((a) => a.value === "-a" || a.value === "--append");
  for (const a of args) {
    const path = a.value.startsWith("-") ? undefined : pathOf(a, env);
    if (path)
      env.files.set(path, held(append ? join3([await existing(path, env), input]) : input));
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
  return held(await stdinText(cmd, env));
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
function parseFlags(args, takes) {
  const flags = [];
  const positionals = [];
  for (let k = 0;k < args.length; k++) {
    const w = args[k];
    const v = w.value;
    if (v === "--") {
      positionals.push(...args.slice(k + 1));
      break;
    }
    if (v.startsWith("--")) {
      const eq = v.indexOf("=");
      const name = eq === -1 ? v : v.slice(0, eq);
      flags.push({
        name,
        value: eq !== -1 ? slice(w, eq + 1) : takes.has(name) ? args[++k] : undefined
      });
    } else if (v.startsWith("-") && v.length > 1) {
      for (let c = 1;c < v.length; c++) {
        const name = `-${v[c]}`;
        if (!takes.has(name)) {
          flags.push({ name });
          continue;
        }
        const rest = c + 1 < v.length ? slice(w, v[c + 1] === "=" ? c + 2 : c + 1) : args[++k];
        flags.push({ name, value: rest });
        break;
      }
    } else
      positionals.push(w);
  }
  return { flags, positionals };
}
var unreadable = (text) => Boolean(text.unknown) || Boolean(text.reads?.length) || marked(text.value);
var fromXargs = (text, xargs) => Boolean(xargs?.replace) && text.value.includes(xargs?.replace ?? "");
var flagFromXargs = (text, xargs) => fromXargs(text, xargs) && (text.value.startsWith(xargs?.replace ?? "") || text.value.startsWith("-"));
function viaXargs(text, xargs) {
  return fromXargs(text, xargs) ? unknown(`what xargs puts in place of ${xargs?.replace}`) : text;
}
function ghCommand(args) {
  const repos = [];
  const head = [];
  let k = 0;
  while (k < args.length && head.length < (head[0] === "api" ? 1 : 2)) {
    const v = args[k].value;
    if (v === "-R" || v === "--repo") {
      if (args[k + 1])
        repos.push(args[k + 1]);
      k += 2;
    } else if (v.startsWith("--repo="))
      repos.push(slice(args[k++], 7));
    else if (v.startsWith("-R"))
      repos.push(slice(args[k++], 2));
    else if (v.startsWith("-"))
      k++;
    else
      head.push(args[k++].value);
  }
  return { head, repos, rest: args.slice(k) };
}
async function ghApi(args, cmd, env, xargs) {
  const { flags, positionals } = parseFlags(args, API_TAKES);
  const [endpoint] = positionals;
  if (!endpoint)
    return;
  const fields = [];
  const inputs = [];
  let method;
  for (const { name, value } of flags) {
    if (!value)
      continue;
    if (name === "-X" || name === "--method")
      method = value.unknown ? "POST" : value.value.toUpperCase();
    else if (name === "--input")
      inputs.push(value.value === "-" ? await stdinOf(cmd, env) : await readPath(value, env));
    else if (API_FIELDS.has(name)) {
      const eq = value.value.indexOf("=");
      const key = eq === -1 ? value.value : value.value.slice(0, eq);
      const field = eq === -1 ? { quoted: false, value: "" } : slice(value, eq + 1);
      const fromFile = (name === "-F" || name === "--field") && field.value.startsWith("@") && !field.unknown;
      const text = !fromFile ? field : field.value === "@-" ? await stdinOf(cmd, env) : await readPath(slice(field, 1), env);
      fields.push(fromXargs(value, xargs) ? { key: "body", text: viaXargs(value, xargs) } : { key, text });
    }
  }
  if (xargs && !xargs.replace) {
    fields.push({
      key: "body",
      text: unknown("the arguments xargs appends; a read passes with -X GET")
    });
  }
  if (args.some((a) => flagFromXargs(a, xargs))) {
    fields.push({ key: "body", text: unknown(`what xargs puts in place of ${xargs?.replace}`) });
  }
  const sent = fields.length + inputs.length > 0;
  return { endpoint, fields, inputs, method: method ?? (sent ? "POST" : "GET") };
}
var curlUrls = (flags, positionals) => [
  ...positionals,
  ...flags.filter((f) => f.name === "--url" && f.value).map((f) => f.value)
];
async function curlData(flags, cmd, env) {
  const data = [];
  for (const { name, value } of flags) {
    if (!value || !CURL_DATA.has(name))
      continue;
    if (name === "-T" || name === "--upload-file")
      data.push(await readPath(value, env));
    else if (value.value.startsWith("@") && name !== "--data-raw" && name !== "--form-string") {
      data.push(value.value === "@-" ? await stdinOf(cmd, env) : await readPath(slice(value, 1), env));
    } else
      data.push(value);
  }
  return data;
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

// scripts/hooks/no-release-comment.ts
var guardedOwners = new Set;
var WORD = /release/i;
var UNRESOLVED = "a repository the hook cannot resolve";
var GROUPS = new Set(["api", "issue", "pr"]);
var spec = (texts, files, others = []) => ({
  files,
  takes: new Set([...files, ...others, ...texts, "-R", "--repo"]),
  texts
});
var COMMENT = spec(["--attach", "-b", "--body"], ["-F", "--body-file"]);
var CLOSING = spec(["-c", "--comment"], []);
var SPECS = new Map([
  ["issue close", spec(["-c", "--comment"], [], ["--duplicate-of", "-r", "--reason"])],
  ["issue comment", COMMENT],
  ["issue reopen", CLOSING],
  ["pr close", CLOSING],
  ["pr comment", COMMENT],
  ["pr reopen", CLOSING],
  ["pr review", spec(["-b", "--body"], ["-F", "--body-file"])]
]);
var PR_URL = /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+/i;
var API_URL = /api\.github\.com\/repos\/([^/\s]+)\/([^/\s]+)\/([^\s?#]+)/i;
var COMMENT_PATH = /(?:^|\/)(?:comments|replies|reviews)(?:\/|$)/;
var COMMENT_MUTATION = /\b(?:addComment|addPullRequestReview(?:Comment|Thread|ThreadReply)?|submitPullRequestReview|updateIssueComment|updatePullRequestReview(?:Comment)?)\b/;
var MCP_COMMENT = /^mcp__.+__(?:add_comment_to_pending_review|add_issue_comment|add_reply_to_pull_request_comment|pull_request_review_write|update_issue_comment)$/;
var BODY_KEY = /body/i;
var GH = /\bgh\b|github/i;
var MAYBE_COMMENT = /\b(?:api|close|comment|reopen|review)/i;
var COMMENT_CALL = /(?:\b|_)(?:close|comment|reopen|review)(?:\b|_)|\bapi\b[\s\S]*(?:comments|graphql|replies|reviews)/i;
var comment = async (cmd, { args, first, local, name, xargs }, env) => {
  if (name === "gh")
    return gh(args, cmd, env, local, xargs);
  if (first?.unknown && GROUPS.has(args[0]?.value ?? ""))
    return gh(args, cmd, env, local, xargs);
  if (name === "curl")
    return curl(args, cmd, env);
  const nested = args.findIndex((a, j) => program(a.value) === "gh" && GROUPS.has(args[j + 1]?.value ?? ""));
  if (nested !== -1 && !PRINTERS.has(name)) {
    return gh(args.slice(nested + 1), cmd, env, local, xargs);
  }
};
async function gh(args, cmd, env, local, xargs) {
  const { head, repos, rest } = ghCommand(args);
  if (head[0] === "api")
    return api(rest, cmd, env, local, xargs);
  const key = head.join(" ");
  const found = SPECS.get(key);
  if (!found)
    return;
  const { flags, positionals } = parseFlags(rest, found.takes);
  const bodies = [];
  for (const { name, value } of flags) {
    const body = found.texts.includes(name) || found.files.includes(name);
    if (!value) {
      if (body)
        bodies.push(unknown(`${name} with no value`));
    } else if (name === "--attach")
      bodies.push(altText(value));
    else if (found.texts.includes(name))
      bodies.push(value);
    else if (found.files.includes(name)) {
      bodies.push(value.value === "-" && !value.unknown ? await stdinOf(cmd, env) : await readPath(value, env));
    } else if (name === "-R" || name === "--repo")
      repos.push(value);
  }
  if (xargs && !xargs.replace)
    bodies.push(unknown("the arguments xargs appends"));
  if (rest.some((a) => flagFromXargs(a, xargs))) {
    bodies.push(unknown(`what xargs puts in place of ${xargs?.replace}`));
  }
  if (bodies.length === 0)
    return;
  const named = [
    ...repos.map((r) => fromXargs(r, xargs) ? undefined : repoOf(r)),
    ...positionals.flatMap((p) => {
      if (unreadable(p) || fromXargs(p, xargs))
        return [undefined];
      return PR_URL.test(p.value) ? [repoOf(p)] : [];
    }),
    ...xargs && !xargs.replace ? [undefined] : []
  ];
  const target = decide(named.length > 0 ? named : implicitRepos(env, local));
  return judge(`gh ${key}`, target, bodies.map((b) => viaXargs(b, xargs)), env);
}
function altText(value) {
  const tail = Math.max(value.value.lastIndexOf(UNKNOWN), value.value.lastIndexOf(READ)) + 1;
  const hash = value.value.indexOf("#");
  const from = hash === -1 ? value.value.lastIndexOf("/") + 1 : hash + 1;
  const alt = slice(value, from);
  return tail > 0 && from > tail ? { reads: alt.reads, value: alt.value } : alt;
}
async function api(args, cmd, env, local, xargs) {
  const request = await ghApi(args, cmd, env, xargs);
  if (!request || ["DELETE", "GET", "HEAD"].includes(request.method))
    return;
  const { endpoint, fields, inputs } = request;
  if (endpoint.value === "graphql") {
    const documents = [...fields.filter((f) => f.key === "query").map((f) => f.text), ...inputs];
    const resolved = await Promise.all(documents.map((d) => resolveText(d, env)));
    if (!resolved.some((d) => d.unknown || COMMENT_MUTATION.test(d.value)))
      return;
    return judge("gh api graphql", { guarded: true, label: "a repository named only by a GraphQL node id" }, [...fields.map((f) => f.text), ...inputs], env, INLINE_QUERY);
  }
  const path = endpoint.value.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "").replace(/^api\/v3\//, "").split("?")[0];
  const match = /^repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(path);
  const rest = match?.[3] ?? /^repositories\/[^/]+\/(.+)$/.exec(path)?.[1];
  const open = marked(path) || fromXargs(endpoint, xargs);
  if (rest !== undefined ? !COMMENT_PATH.test(rest) && !open : !open)
    return;
  let candidates = [undefined];
  if (match?.[1] === "{owner}")
    candidates = implicitRepos(env, local);
  else if (match && !marked(match[1]) && !fromXargs({ value: `${match[1]}/${match[2]}` }, xargs)) {
    candidates = [{ owner: match[1], repo: match[2] }];
  }
  const bodies = [
    ...fields.filter((f) => marked(f.key) || BODY_KEY.test(f.key)).map((f) => f.text),
    ...await Promise.all(inputs.map((i) => bodyOf(i, env)))
  ];
  return judge(`gh api ${path.replaceAll(UNKNOWN, "*").replaceAll(READ, "*")}`, decide(candidates), bodies, env);
}
async function bodyOf(payload, env) {
  const text = await resolveText(payload, env);
  if (text.unknown)
    return text;
  let parsed;
  try {
    parsed = JSON.parse(text.value);
  } catch {
    return text;
  }
  const found = [];
  const visit = (node, inBody) => {
    if (typeof node === "string" && inBody)
      found.push(node);
    else if (Array.isArray(node))
      for (const item of node)
        visit(item, inBody);
    else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node))
        visit(value, inBody || BODY_KEY.test(key));
    }
  };
  visit(parsed, false);
  return { value: found.join(`
`) };
}
async function curl(args, cmd, env) {
  const { flags, positionals } = parseFlags(args, CURL_TAKES);
  const url = curlUrls(flags, positionals).map((u) => API_URL.exec(u.value)).find((m) => m !== null);
  if (!url || !COMMENT_PATH.test(url[3]))
    return;
  const data = await curlData(flags, cmd, env);
  if (data.length === 0)
    return;
  const owner = marked(url[1]) ? undefined : { owner: url[1], repo: url[2] };
  return judge(`curl to api.github.com/repos/${url[1]}/${url[2]}`, decide([owner]), await Promise.all(data.map((d) => bodyOf(d, env))), env);
}
function decide(candidates) {
  if (candidates.length === 0)
    return { guarded: true, label: UNRESOLVED };
  const hit = candidates.findIndex((c) => !c || guardedOwners.has(c.owner.toLowerCase()));
  if (hit === -1)
    return { guarded: false, label: "" };
  const repo = candidates[hit];
  return { guarded: true, label: repo ? `${repo.owner}/${repo.repo}` : UNRESOLVED };
}
function refuse(what, target, detail, fix) {
  return `no-release-comment hook refused ${what} on ${target.label}: ${detail}. On a guarded owner's repos an owner comment containing "release" in any case publishes to npm, and gh and the GitHub MCP post as that owner. ${fix}`;
}
var READABLE = "Put the text in the command itself, or write the text to a file with the Write tool first, then run the command again in a call of its own that names that file by its literal absolute path (--body-file /abs/body.md).";
var INLINE_QUERY = "Write the query and each of its fields in the command itself, not in a variable: gh api graphql -f query='query { viewer { login } }'. For a long one, write it to a file with the Write tool first and pass it by its literal absolute path (-F query=@/abs/query.graphql, -F body=@/abs/body.md).";
var REWORD = 'Write "ship" or "publish step" instead, or leave the comment out. For a file or rule whose name holds the word, name it by what it is, such as "the ship rule" or "the comment hook", with its line number; for a patch that holds it, write the patch to a file in your scratchpad, send its absolute path to the PR\'s worker by SendMessage, and say in the comment that a patch went to the author, since gh\'s `--attach` uploads only images and video.';
async function judge(what, target, bodies, env, fix = READABLE) {
  if (!target.guarded)
    return;
  const texts = await Promise.all(bodies.map((b) => resolveText(b, env)));
  if (texts.some((t) => WORD.test(visible(t.value))))
    return refuse(what, target, 'its text contains "release"', REWORD);
  const hidden = texts.find((t) => t.unknown);
  if (hidden) {
    return refuse(what, target, `the hook cannot read its text before the command runs (it comes from ${hidden.unknown})`, fix);
  }
}
function mcp(tool, input) {
  const what = tool.replace(/^mcp__/, "");
  if (!input)
    return refuse(what, { guarded: true, label: UNRESOLVED }, "its input is not an object", REWORD);
  const { body, owner, repo } = input;
  if (body === undefined || body === null)
    return;
  const named = typeof owner === "string" && owner !== "" ? { owner, repo: typeof repo === "string" ? repo : "?" } : undefined;
  const target = decide([named]);
  if (!target.guarded)
    return;
  if (typeof body !== "string")
    return refuse(what, target, "its body is not text the hook can read", REWORD);
  if (WORD.test(body))
    return refuse(what, target, 'its text contains "release"', REWORD);
}
var commentCall = (raw) => GH.test(raw) && COMMENT_CALL.test(raw);
function candidate(command) {
  const bare = command.replace(/[\\'"]/g, "");
  return command.includes("$'") || GH.test(bare) && MAYBE_COMMENT.test(bare);
}
async function check(raw, environment = process.env, lists = join4(coreDir(), "lists")) {
  const owners = await guardList("no-release-comment", "release-owners", isStrings, [], environment, join4(lists, "release-owners.json"));
  if (owners.refusal)
    return commentCall(subjectOf(raw)) ? owners.refusal : undefined;
  guardedOwners = new Set((owners.list ?? []).map((owner) => owner.toLowerCase()));
  try {
    return await inspect(raw, environment);
  } catch (error) {
    if (!commentCall(subjectOf(raw)))
      return;
    return `no-release-comment hook could not read this call (${error}), which reads as a GitHub comment, so it refuses it. Split it into plain commands and run them again.`;
  }
}
function subjectOf(raw) {
  try {
    const { tool_input: toolInput, tool_name: tool } = JSON.parse(raw);
    if (tool === "Bash" && typeof toolInput?.command === "string")
      return toolInput.command;
    return typeof tool === "string" ? tool : raw;
  } catch {
    return raw;
  }
}
async function inspect(raw, environment) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = undefined;
  }
  if (typeof payload !== "object" || payload === null) {
    return commentCall(raw) ? "no-release-comment hook could not parse its input, which reads as a GitHub comment, so it refuses the call." : undefined;
  }
  const { cwd, tool_input: toolInput, tool_name: tool } = payload;
  const input = typeof toolInput === "object" && toolInput !== null ? toolInput : undefined;
  if (tool === "Bash") {
    const command = input?.command;
    if (typeof command !== "string" || !candidate(command))
      return;
    const directory = typeof cwd === "string" ? cwd : undefined;
    const env = {
      cwd: directory,
      files: new Map,
      known: knownVariables(command, environment, directory),
      process: environment,
      vars: new Map
    };
    return run(lex(command, env.known), env, comment);
  }
  if (typeof tool === "string" && MCP_COMMENT.test(tool))
    return mcp(tool, input);
}
if (import.meta.main) {
  const reason = await check(await Bun.stdin.text());
  if (reason) {
    console.error(reason);
    process.exit(2);
  }
}
export {
  check
};
