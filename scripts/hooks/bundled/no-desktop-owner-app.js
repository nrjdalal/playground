// @bun
const __HOOK_DIR = import.meta.dir.slice(0, import.meta.dir.lastIndexOf("/"));

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

// scripts/hooks/lists.ts
import { existsSync as existsSync2 } from "fs";

// packages/env/src/data-dir.ts
import { homedir } from "os";
import { join, resolve } from "path";
var dataDirOf = (env, home = env.HOME || homedir()) => env.PLAYGROUND_DATA_DIR ? resolve(env.PLAYGROUND_DATA_DIR) : join(home, ".playground");
var dataDir = (env = process.env) => dataDirOf(env);

// packages/settings/src/rendered.ts
import { existsSync, readFileSync } from "fs";
import { join as join2 } from "path";
import { fileURLToPath } from "url";
var CORE = "core";
var coreDir = () => fileURLToPath(new URL("../../../extensions/core", import.meta.url));
var extensionsDir = (data) => join2(data, "extensions");
var markerPath = extensionsDir;
var fixFor = (file) => file.startsWith("hooks/") ? "tell your lead, and the dispatcher hands the owner ! playground ext import --from-tree extensions/core/lists to type in the dispatcher's terminal window, which seeds the guards' lists" : "tell your lead, and the dispatcher hands the owner ! playground ext init, then a setting with ! playground settings set, to type in the dispatcher's terminal window, which writes it";
var readRendered = async (data, file) => readRenderedSync(data, file);
var readRenderedSync = (data, file) => {
  const dir = extensionsDir(data);
  if (!existsSync(dir))
    return {};
  const parts = file.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    return { refusal: `${file} is not a path inside the extensions (${dir})` };
  const path = parts[0] === CORE ? join2(coreDir(), ...parts.slice(1)) : join2(dir, file);
  return existsSync(path) ? { path } : { refusal: `the extensions root (${dir}) holds no ${file}: ${fixFor(file)}` };
};

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
import { basename, isAbsolute, resolve as resolve2 } from "path";
var UNKNOWN = "\x00";
var READ = "\x01";
var MAX_BYTES = 1048576;
var MAX_SCRIPT = 131072;
var LARGE = "a text too large to read";
var deadline;
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
    else if (c === "$")
      merge(out, dollar(lx));
    else if (c === "`")
      merge(out, backtick(lx));
    else if (c === "~" && lx.i === start && (next === "" || next === "/" || BREAK.has(next))) {
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
  return out;
}
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
  return unwrap(state, undefined, { left: READINGS });
}
var assign = (local, w) => {
  const eq = w.value.indexOf("=");
  local.set(w.value.slice(0, eq), slice(w, eq + 1));
};
function unwrap(state, inside, budget) {
  const { local, rest } = state;
  const peek = () => rest[rest.length - 1];
  const take = () => rest.pop();
  const also = [];
  const fork = (wrapper, drop) => budget.left-- > 0 && also.push(unwrap({
    chdir: state.chdir,
    local: new Map(local),
    rest: rest.slice(0, Math.max(0, rest.length - drop)),
    xargs: state.xargs && { ...state.xargs }
  }, wrapper, budget));
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
  const readings = (parsed) => [parsed, ...parsed.also.flatMap(readings)];
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
    env.cwd = cmd.detached ? undefined : await cdTarget(args, env);
  } else if (name === "popd")
    env.cwd = undefined;
  else if (EXPORTS.has(name)) {
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
async function cdTarget(args, env) {
  const dir = args.find((a) => !(a.value.startsWith("-") && a.value.length > 1));
  if (!dir)
    return homedir2();
  const path = dir.value === "-" ? undefined : pathOf(dir, env);
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
var unreadable = (text) => Boolean(text.unknown) || Boolean(text.reads?.length) || marked(text.value);

// scripts/hooks/no-desktop-owner-app.ts
var GUARD = "no-desktop-owner-app";
var TOOL = /^agent-desktop(?:@.*)?$/;
var MENTION = /agent-desktop/;
var LAUNCHERS = new Set([
  "bun",
  "bunx",
  "find",
  "flock",
  "npm",
  "npx",
  "pnpm",
  "pnpx",
  "setsid",
  "watch",
  "yarn"
]);
var LINES = new Set(["flock", "setsid", "watch"]);
var WATCH_TAKES = new Set(["--equexit", "--interval", "--shotsdir", "-n", "-q", "-s"]);
var INTERPRETERS = new Set([
  "bun",
  "deno",
  "node",
  "osascript",
  "perl",
  "python",
  "python3",
  "ruby"
]);
var TAKES = new Set([
  "--agent-id",
  "--screenshot",
  "--session",
  "--trace",
  "--wait-for",
  "--wait-for-gone",
  "--wait-timeout",
  "-w"
]);
var FRONT = new Set([
  "dismiss-all-notifications",
  "dismiss-notification",
  "find",
  "focus-window",
  "list-notifications",
  "list-surfaces",
  "maximize",
  "minimize",
  "move-window",
  "press",
  "resize-window",
  "restore",
  "screenshot",
  "snapshot"
]);
var ROOTED = new Set(["find", "snapshot"]);
var TARGETED = new Set(["close-app", "launch"]);
var OWNER = "tell your lead, and the dispatcher hands the owner the command to run with the ! prefix in the dispatcher's terminal window, where it runs outside the hooks";
var headed = () => `${GUARD} hook refused this agent-desktop call: it carries --headed, whose physical input moves the owner's own pointer and focus. --headed is the owner's alone, so ${OWNER}.`;
var listed = (app) => `${GUARD} hook refused this agent-desktop call: it targets ${app}, an app on the desktop-owner-apps guard list of the owner's own apps. Leave it alone; when the task needs it, ${OWNER}; or, to take ${app} off the list in the owner's login extension, tell your lead, and the dispatcher hands the owner the ! command that does it.`;
var unread = (what) => `${GUARD} hook refused this agent-desktop call: it cannot read ${what} before the command runs, so it cannot tell whether the call carries --headed or targets an app on the desktop-owner-apps list. Write the agent-desktop command's every word literally as a command of its own, or ${OWNER}.`;
var front = (sub) => `${GUARD} hook refused this agent-desktop call: ${sub} with no --app acts on the app in front, which may be one of the owner's own. Name the app with --app <App>, or act on a ref a snapshot of that app gave.`;
var SCRIPT_IN_CALL = "a script file in a call that names agent-desktop, since the call may change it";
var reasonOf = (refusal) => refusal.split(/: tell your lead, and the dispatcher hands the owner|\. Restore the file/)[0];
var appName = (value) => (value.split("/").filter(Boolean).pop() ?? "").replace(/\.app$/i, "").trim().toLowerCase();
function judge(words, viaXargs, apps) {
  if (viaXargs)
    return unread("the words xargs appends");
  const hidden = words.find((w) => unreadable(w));
  if (hidden)
    return unread(hidden.unknown ? `a word built from ${hidden.unknown}` : "a word");
  const values = words.map((w) => w.value);
  if (values.some((v) => v === "--headed" || v.startsWith("--headed=")))
    return headed();
  let sub = "";
  let at = -1;
  for (let k = 0;k < values.length; k++) {
    if (TAKES.has(values[k]))
      k++;
    else if (!values[k].startsWith("-")) {
      sub = values[k];
      at = k;
      break;
    }
  }
  if (sub === "batch")
    return unread("the commands a batch's JSON holds; run each on its own");
  if (sub === "notification-action")
    return unread("which app a notification index belongs to");
  if (values.some((v) => v === "--window-id" || v.startsWith("--window-id=")))
    return unread("which app a --window-id belongs to");
  const named = [];
  values.forEach((v, k) => {
    if (v === "--app" && values[k + 1] !== undefined)
      named.push(values[k + 1]);
    else if (v.startsWith("--app="))
      named.push(v.slice("--app=".length));
  });
  if (TARGETED.has(sub))
    named.push(...values.slice(at + 1).filter((v) => !v.startsWith("-")));
  const hit = named.find((v) => apps.has(appName(v)));
  if (hit)
    return listed(hit);
  const rooted = ROOTED.has(sub) && values.some((v) => v === "--root" || v.startsWith("--root="));
  if (FRONT.has(sub) && named.length === 0 && !rooted)
    return front(sub);
}
var OPENER_BEFORE = new Set(["(", ",", "=", ":", "+", ";"]);
var CLOSER_AFTER = new Set([")", "]", "}", ",", ";", ".", "+", ":"]);
var opensAt = (code, k) => k === 0 || /\s/.test(code[k - 1]) || OPENER_BEFORE.has(code[k - 1]);
var closesAt = (code, k) => k >= code.length || /\s/.test(code[k]) || CLOSER_AFTER.has(code[k]);
function quotedParts(code) {
  const strings = [];
  let outside = "";
  let k = 0;
  while (k < code.length) {
    const c = code[k];
    if (c !== "'" && c !== '"' && c !== "`" || !opensAt(code, k)) {
      outside += c;
      k++;
      continue;
    }
    const quote = code.startsWith(c.repeat(3), k) ? c.repeat(3) : c;
    let text = "";
    let closed = false;
    k += quote.length;
    while (k < code.length) {
      if (code[k] === "\\") {
        text += code.slice(k, k + 2);
        k += 2;
      } else if (code.startsWith(quote, k)) {
        closed = closesAt(code, k + quote.length);
        k += quote.length;
        break;
      } else
        text += code[k++];
    }
    strings.push({ closed, quote, text });
    outside += " ";
  }
  return { outside, strings };
}
var RUNNERS = new Set([...LAUNCHERS, ...SHELLS, "command", "exec", "time", "xargs"]);
async function runsTool(line) {
  try {
    const env = { cwd: undefined, files: new Map, known: {}, process: {}, vars: new Map };
    const visit = async (_, { args, first, name }) => TOOL.test(name) || first !== undefined && unreadable(first) || LAUNCHERS.has(name) && args.some((a) => TOOL.test(program(a.value))) || (INTERPRETERS.has(name) || LINES.has(name)) && args.some((a) => MENTION.test(a.value)) || name === "source" || name === "." || first?.value.includes("/") ? "runs" : undefined;
    return await run(lex(line), env, visit) !== undefined;
  } catch {
    return true;
  }
}
async function prose(text) {
  if (/['"`\\${}\n\r]/.test(text))
    return false;
  for (const match of text.matchAll(/agent-desktop/g)) {
    const before = text.slice(0, match.index);
    const word = before.trimEnd().split(/\s+/).pop() ?? "";
    if (!/\s$/.test(before) || !/[\p{L}\p{N},:.]$/u.test(word) || word.startsWith("-"))
      return false;
    const last = word.replace(/[,:.]+$/, "").split(/[^\w.-]/).pop() ?? "";
    if (RUNNERS.has(last.toLowerCase()))
      return false;
  }
  return !await runsTool(text);
}
async function callsTool(code) {
  if (!MENTION.test(code))
    return false;
  const { outside, strings } = quotedParts(code);
  if (MENTION.test(outside))
    return true;
  for (const { closed, quote, text } of strings)
    if (MENTION.test(text) && !(closed && (quote === "'" || quote === '"') && await prose(text)))
      return true;
  return false;
}
function lister(environment) {
  let loaded;
  return () => loaded ??= guardList(GUARD, "desktop-owner-apps", isStrings, [], environment).then((l) => l.refusal ? {
    refusal: `${reasonOf(l.refusal)}. The list changes only by the owner's own ! command: tell your lead, and the dispatcher hands the owner the command, then run the call again.`
  } : { apps: new Set((l.list ?? []).map(appName)) });
}
async function judgeText(text, cwd, apps, depth) {
  const lexed = lex(text);
  const mention = MENTION.test(text.replace(/["'\\]/g, ""));
  const env = { cwd, files: new Map, known: {}, process: {}, vars: new Map };
  for (const cmd of lexed.commands) {
    const { args, name } = parse(cmd);
    if (!SHELLS.has(name))
      continue;
    const { inline, operand } = shellOperand(args, name);
    if (operand && !inline) {
      const verdict = await script(operand, env, mention, apps, depth);
      if (verdict)
        return verdict;
    }
  }
  const visit = async (cmd, parsed, here) => {
    const { args, first, name, xargs } = parsed;
    if (name === "run-slot.sh") {
      const at = args.findIndex((a) => a.value === "--");
      const inner = { ...cmd, words: at === -1 ? [] : args.slice(at + 1) };
      return inner.words.length === 0 ? undefined : examine(inner, here, visit, false);
    }
    if (LINES.has(name) && mention) {
      const lines = args.filter((a) => /\s/.test(a.value)).map((a) => a.value);
      if (name === "watch") {
        let k = 0;
        while (args[k]?.value.startsWith("-"))
          k += WATCH_TAKES.has(args[k].value) ? 2 : 1;
        lines.push(args.slice(k).map((a) => a.value).join(" "));
      }
      for (const line of lines) {
        const verdict = await judgeText(line, here.cwd, apps, depth + 1);
        if (verdict)
          return verdict;
      }
    }
    let words;
    if (TOOL.test(name))
      words = args;
    else if (LAUNCHERS.has(name)) {
      const at = args.findIndex((a) => TOOL.test(program(a.value)));
      if (at !== -1)
        words = args.slice(at + 1);
    }
    if (words) {
      const list = await apps();
      return list.refusal ?? judge(words, xargs !== undefined, list.apps ?? new Set);
    }
    if (!mention) {
      const path = name === "source" || name === "." ? args[0] : undefined;
      return path || first?.value.includes("/") ? script(path ?? first, here, false, apps, depth) : undefined;
    }
    if (first && unreadable(first))
      return unread(`the program it runs (it comes from ${first.unknown ?? "a word it cannot read"})`);
    if (INTERPRETERS.has(name)) {
      for (const a of args)
        if (await callsTool(a.value))
          return unread(`what ${name} runs`);
    }
    if (name === "source" || name === "." || first?.value.includes("/"))
      return unread(SCRIPT_IN_CALL);
  };
  return run(lexed, env, visit);
}
async function script(path, env, mention, apps, depth) {
  if (mention)
    return unread(SCRIPT_IN_CALL);
  const text = await readPath(path, env);
  if (text.unknown || !MENTION.test(text.value) || depth > 2)
    return;
  return judgeText(text.value, env.cwd, apps, depth + 1);
}
async function check(raw, environment = process.env) {
  try {
    const {
      cwd,
      tool_input: toolInput,
      tool_name: tool
    } = JSON.parse(raw);
    if (tool !== "Bash" || typeof toolInput?.command !== "string")
      return;
    return await judgeText(toolInput.command, typeof cwd === "string" ? cwd : undefined, lister(environment), 0);
  } catch {
    return;
  }
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
