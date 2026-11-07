// @bun
const __CHECKOUT = import.meta.dir.slice(0, import.meta.dir.lastIndexOf("/scripts/hooks/bundled"));

// scripts/hooks/no-extensions-write.ts
import { existsSync, statSync } from "fs";
import { homedir as homedir3 } from "os";
import { dirname as dirname3, join as join5, resolve as resolve4, sep as sep2 } from "path";

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
import { basename as basename2, dirname as dirname2, isAbsolute as isAbsolute2, join as join4, normalize, resolve as resolve3, sep } from "path";

// packages/config/src/kinds.ts
var ROSTER_KINDS = [
  "assistant",
  "builder",
  "dispatcher",
  "ops",
  "optimizer",
  "orchestrator",
  "planner",
  "probe",
  "researcher",
  "reviewer",
  "runner",
  "tester",
  "worker"
];
var ID_ALPHABET = "23456789bcdfghjkmnpqrstvwxyz";
var ID_NAME_SOURCE = `[${ID_ALPHABET}]{6}-(?:${ROSTER_KINDS.join("|")})`;
var ID_NAME = new RegExp(`^[${ID_ALPHABET}]{6}-(${ROSTER_KINDS.join("|")})$`);
var NAMES = Symbol.for("playground.sessionNames");
var SEATLESS = new Set(["ended", "parked"]);

// scripts/hooks/role.ts
var MANAGER_ROLES = new Set(["dispatcher", "lead", "manager"]);

// scripts/hooks/shell.ts
import { homedir as homedir2 } from "os";
import { basename, dirname, isAbsolute, resolve as resolve2 } from "path";
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
var onlyReserved = (cmd) => cmd.words.length > 0 && cmd.words.every((w) => !w.quoted && RESERVED.has(w.value));
var GROUPING = new Set(["}", "done", "esac", "fi"]);
var ASSIGN = /^[A-Za-z_]\w*=/;
var WRAPPERS = new Map(Object.entries({
  builtin: ["", ""],
  busybox: ["", ""],
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
  cmd = spreadSplit(cmd);
  const parsed = parse(cmd);
  const kinds = readings(parsed).map((reading) => stdinShellOf(cmd, reading));
  if (parsed.capped) {
    const names = cmd.words.map((w) => program(w.value));
    if (names.some((n) => ROOT_SHELLS.has(n) || n === "su"))
      kinds.push("root");
    else if (names.some((n) => SHELLS.has(n)))
      kinds.push("shell");
  }
  return kinds.includes("root") ? "root" : kinds.includes("shell") ? "shell" : kinds.find(Boolean);
}
function spreadSplit(cmd) {
  if (!cmd.words.some((w) => program(w.value) === "env"))
    return cmd;
  const options = WRAPPERS.get("env");
  const out = [];
  const rest = [...cmd.words].reverse();
  let inEnvOptions = false;
  let spreadOne = false;
  for (let w = rest.pop();w; w = rest.pop()) {
    const v = w.value;
    const long = inEnvOptions ? envLong(v) : undefined;
    const split = long?.name === "split-string" ? long.value ?? "" : long || !inEnvOptions ? undefined : SPLIT.exec(v)?.[1];
    if (split !== undefined) {
      const text = (split || rest.pop()?.value || "").replace(/\$\{[^}]*\}/g, UNKNOWN).replace(/\\[_fnrtv]/g, " ").replace(/['"\\]/g, "");
      const words = text.split(/\s+/).filter(Boolean);
      for (let j = words.length - 1;j >= 0; j--)
        rest.push({ quoted: false, value: words[j] });
      spreadOne = true;
      continue;
    }
    if (inEnvOptions && v === "-") {
      out.push({ ...w, value: "-i" });
      continue;
    }
    out.push(w);
    if (program(v) === "env")
      inEnvOptions = true;
    else if (!inEnvOptions || ASSIGN.test(v))
      continue;
    else if (!v.startsWith("-") || v === "--")
      inEnvOptions = false;
    else if (long ? ENV_LONG_VALUES.has(long.name) && long.value === undefined : ENV_SHORT_VALUE.test(v) || optionValue(v, options) === "next") {
      const value = rest.pop();
      if (value)
        out.push(value);
    }
  }
  return spreadOne ? { ...cmd, words: out } : cmd;
}
var ENV_LONG = [
  "argv0",
  "block-signal",
  "chdir",
  "debug",
  "default-signal",
  "help",
  "ignore-environment",
  "ignore-signal",
  "list-signal-handling",
  "null",
  "split-string",
  "unset",
  "version"
];
var ENV_LONG_VALUES = new Set(["argv0", "chdir", "split-string", "unset"]);
var ENV_SHORT_VALUE = /^-[0iv]*[aCu]$/;
function envLong(v) {
  const m = /^--([a-z0-9-]+)(?:=([\s\S]*))?$/.exec(v);
  if (!m)
    return;
  const hits = ENV_LONG.filter((o) => o.startsWith(m[1]));
  const name = hits.includes(m[1]) ? m[1] : hits.length === 1 ? hits[0] : undefined;
  return name ? { name, value: m[2] } : undefined;
}
function stdinShellOf(cmd, { args, first, name, xargs }) {
  const fed = !!cmd.stdin || !!xargs;
  if (first && !marked(first.value)) {
    if (name === "." || name === "source" || name === "eval")
      return fed || name !== "eval" && STDIN_PATHS.has(args[0]?.value ?? "") ? "shell" : undefined;
    const family = familyOf(name);
    if (family)
      return fed && interpreted(family, args, xargs) ? "code" : undefined;
    if (name === "su")
      return suCommand(args) ? undefined : "root";
    if (!SHELLS.has(name))
      return;
    if (fed)
      return "shell";
    const { inline, operand } = shellOperand(args, name);
    return inline || operand && !STDIN_PATHS.has(operand.value) ? undefined : "shell";
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
    if (w === firstWrapper || ROOT_SHELLS.has(w.value.toLowerCase()))
      wrappers.push(program(w.value));
  }
  if (first && wrappers.length)
    return "root";
  return fed && first ? "shell" : undefined;
}
var SU_PLAIN = new Set(["-", "-f", "-l", "-m"]);
var suCommand = (args) => {
  for (const [at, word] of args.entries()) {
    const { value } = word;
    if (word.unknown !== undefined || word.glob || marked(value))
      return false;
    if (value === "-c" || value === "--command")
      return at + 1 < args.length;
    if (value.startsWith("--command="))
      return true;
    if (value.startsWith("-") && !SU_PLAIN.has(value))
      return false;
  }
  return false;
};
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
var FAMILIES = {
  bun: { takes: ["--cwd", "--env-file", "--preload", "--tsconfig-override"], values: "r" },
  deno: { takes: ["--config", "--import-map"], values: "c" },
  lua: { takes: [], values: "l" },
  node: {
    takes: [
      "--conditions",
      "--env-file",
      "--experimental-loader",
      "--import",
      "--input-type",
      "--inspect-port",
      "--loader",
      "--max-old-space-size",
      "--require",
      "--stack-size",
      "--title"
    ],
    values: "Cr"
  },
  osascript: { takes: [], values: "ls" },
  perl: { takes: [], values: "I" },
  php: { own: "f", takes: [], values: "cdf" },
  python: { own: "m", takes: ["--check-hash-based-pycs"], values: "WXm" },
  ruby: { takes: [], values: "CEIr" }
};
var FAMILY = /^(bun|deno|lua|luajit|node|nodejs|osascript|perl|php|python|ruby)[\d.]*$/;
var familyOf = (name) => {
  const base = FAMILY.exec(name)?.[1];
  return base ? FAMILIES[base === "nodejs" ? "node" : base === "luajit" ? "lua" : base] : undefined;
};
function interpreted(family, args, xargs) {
  const filled = (word) => marked(word.value) || !!xargs?.replace && word.value.includes(xargs.replace);
  const own = (word) => !!word && !filled(word) && !STDIN_PATHS.has(word.value);
  const runner = family === FAMILIES.bun || family === FAMILIES.deno;
  const script = (word) => own(word) && (!runner || /\.[cm]?[jt]sx?$/.test(word?.value ?? ""));
  let sub = false;
  for (let k = 0;k < args.length; k++) {
    const { value } = args[k];
    if (value === "--")
      return !script(args[k + 1]);
    if (value.startsWith("--")) {
      if (!family.takes.includes(value.split("=")[0]))
        return true;
      if (!value.includes("="))
        k++;
      continue;
    }
    if (value.startsWith("-") && value !== "-") {
      const [letter, attached] = [value[1], value.slice(2)];
      if (!family.values.includes(letter))
        return true;
      if (letter === family.own)
        return !own(attached ? { ...args[k], value: attached } : args[k + 1]);
      if (!attached)
        k++;
      continue;
    }
    if (runner && !sub && value === "run") {
      sub = true;
      continue;
    }
    return !script(args[k]);
  }
  return true;
}
function codeFed(commands) {
  const fed = new Map;
  const add = (cmd, kind) => {
    if (!kind || !cmd.stdin)
      return;
    const known = fed.get(cmd.stdin);
    if (known?.kind !== "code")
      fed.set(cmd.stdin, { consumer: cmd, kind });
  };
  for (const [k, cmd] of commands.entries()) {
    if (!cmd.stdin)
      continue;
    add(cmd, stdinShell(cmd));
    let depth = 0;
    for (let j = k;j < commands.length; j++) {
      const body = commands[j];
      for (const m of markers(body.words))
        depth += OPENS.has(m) ? 1 : CLOSES.has(m) ? -1 : 0;
      if (j > k)
        add(cmd, stdinShell({ ...body, stdin: cmd.stdin }));
      if (depth <= 0)
        break;
    }
  }
  return fed;
}
var COUNTED = new Set(["repeat", "timeout"]);
var SHELLS = new Set(["bash", "csh", "dash", "fish", "ksh", "sh", "tcsh", "zsh"]);
var SPLITTERS = new Set(["bash", "csh", "dash", "fish", "ksh", "sh", "tcsh"]);
var ZSH_SPLITS = /\b(?:setopt|unsetopt|emulate|mapfile|readarray|zparseopts)\b|\boptions\[|[\w\]]\+?=\(|\bset\s+[-+][A-Za-z]*[oyA]|(?:^|[;&|({\n]|\b(?:then|do|else)\s)[ \t]*(?:(?:builtin|command)\s+)?(?:source|\.)\s/;
var ARRAY_MAKERS = /\b(?:declare|export|float|integer|local|read|readonly|typeset)\b/;
var zshSplits = (line) => {
  if (ZSH_SPLITS.test(line))
    return true;
  for (const command of line.replace(/\\\n/g, "").split(/[;&|\n]/)) {
    const at = command.search(ARRAY_MAKERS);
    if (at >= 0 && /\s[-+][A-Za-z]*[aA]/.test(command.slice(at)))
      return true;
  }
  const joined = line.replace(/[\\'"]/g, "");
  const expansion = /\$\{?[=~^]?([A-Za-z_]\w*)/g;
  const named = new Set(joined.replace(expansion, " ").match(/(?<![\w$])[A-Za-z_]\w*/g));
  return [...joined.matchAll(expansion)].some(([, name]) => named.has(name));
};
var ONE_WORD = /^\$(?:([A-Za-z_]\w*)|\d|\{(?:([A-Za-z_]\w*)|\d+)\})$/;
var ZSH_ARRAYS = new Set([
  "aliases",
  "argv",
  "builtins",
  "cdpath",
  "commands",
  "comppostfuncs",
  "compprefuncs",
  "compstate",
  "dirstack",
  "dis_aliases",
  "dis_builtins",
  "dis_functions",
  "dis_functions_source",
  "dis_galiases",
  "dis_patchars",
  "dis_reswords",
  "dis_saliases",
  "epochtime",
  "errnos",
  "fignore",
  "fpath",
  "funcfiletrace",
  "funcsourcetrace",
  "funcstack",
  "functions",
  "functions_source",
  "functrace",
  "galiases",
  "history",
  "historywords",
  "jobdirs",
  "jobstates",
  "jobtexts",
  "keymaps",
  "killring",
  "langinfo",
  "mailpath",
  "manpath",
  "match",
  "mbegin",
  "mend",
  "module_path",
  "modules",
  "nameddirs",
  "options",
  "parameters",
  "patchars",
  "path",
  "pipestatus",
  "psvar",
  "region_highlight",
  "registers",
  "reply",
  "reswords",
  "saliases",
  "signals",
  "sysparams",
  "termcap",
  "terminfo",
  "userdirs",
  "usergroups",
  "watch",
  "widgets",
  "words",
  "zle_bracketed_paste",
  "zle_highlight",
  "zsh_eval_context",
  "zsh_scheduled_events"
]);
var oneWord = (written) => {
  const plain = ONE_WORD.exec(written);
  return !!plain && !ZSH_ARRAYS.has(plain[1] ?? plain[2] ?? "");
};
var QUOTED_ONE_WORD = /^(?:\$(?:[A-Za-z_]\w*|\d|\{(?:[A-Za-z_]\w*|\d+)(?::?[-+=?][^}@]*|(?:[#%]{1,2}|\/{1,2})[^}]*)?\}|\([\s\S]*\))|`[\s\S]*`)$/;
var STDIN_PATHS = new Set(["-", "/dev/fd/0", "/dev/stdin", "/proc/self/fd/0"]);
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
  if (part.splits && out.splits !== "always")
    out.splits = part.splits;
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
var SHELL_OWN = new Set([
  ".",
  "alias",
  "cd",
  "declare",
  "eval",
  "export",
  "hash",
  "let",
  "local",
  "popd",
  "pushd",
  "read",
  "readonly",
  "set",
  "shift",
  "source",
  "trap",
  "type",
  "typeset",
  "unalias",
  "unset"
]);
var G_WRAPPERS = new Map([
  ["genv", "env"],
  ["gnice", "nice"],
  ["gnohup", "nohup"],
  ["gstdbuf", "stdbuf"],
  ["gtimeout", "timeout"]
]);
var program = (value) => {
  const base = basename(value.replace(/^=/, ""));
  const lower = base.toLowerCase();
  if (SHELL_OWN.has(lower) && value !== lower)
    return value;
  return G_WRAPPERS.get(lower) ?? lower;
};
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
  calledAgain(lx.commands, src);
  braced(lx.commands);
  return { commands: lx.commands, scopes: lx.scopes };
}
var BRACED = new Set([
  "elif",
  "else",
  "for",
  "foreach",
  "if",
  "repeat",
  "select",
  "until",
  "while"
]);
function braced(commands) {
  for (const [k, c] of commands.entries()) {
    const head = c.words[0];
    if (!head || head.quoted || !BRACED.has(head.value))
      continue;
    const at = c.words.findIndex((w, i) => i > 0 && !w.quoted && w.value === "{");
    if (at < 0 || markers(c.words).length > at)
      continue;
    if (commands.slice(k + 1).some((d) => d.words.some((w) => !w.quoted && w.value === "}")))
      c.opaque = true;
  }
}
function calledAgain(commands, src) {
  for (const [k, open] of commands.entries()) {
    const [first, second] = open.words;
    if (!open.held || !first || first.quoted)
      continue;
    const before = commands[k - 1]?.words;
    const word = first.value === "function" ? second : open.group && before?.length === 1 ? before[0] : undefined;
    if (!word)
      continue;
    let end = k;
    for (let balance = 0;end < commands.length; end++) {
      const reserved = markers(commands[end].words);
      balance += reserved.filter((w) => OPENS.has(w)).length - reserved.filter((w) => CLOSES.has(w)).length;
      if (balance <= 0)
        break;
    }
    const body = commands.slice(k, end + 1);
    const name = word.value.replace(/\(\)$/, "");
    if (word.quoted || !/^[\w.:-]+$/.test(name)) {
      for (const c of body)
        c.repeated = true;
      continue;
    }
    const outside = commands.filter((_, at) => at < k - 1 || at > end).map(callee);
    const calls = outside.filter((w) => w?.value === name);
    const others = outside.some((w) => w !== undefined && (w.unknown !== undefined || !w.quoted && (w.value === "eval" || w.value === "source" || w.value === ".")));
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const files = commands.flatMap((c) => c.redirects).filter((r) => r.target?.value === name).length;
    const mentions = (src.match(new RegExp(`(?<![\\w.:-])${escaped}(?![\\w.:-])`, "g"))?.length ?? 0) - files;
    const call = commands.find((c, at) => (at < k - 1 || at > end) && callee(c)?.value === name);
    const once = mentions === 2 && calls.length === 1 && !others && !call?.repeated && !call?.kept;
    if (!once)
      for (const c of body)
        c.repeated = true;
  }
}
function callee(cmd) {
  return cmd.words.find((w) => w.quoted || !(ASSIGN.test(w.value) || MARKERS.has(w.value) || BUILTIN.has(w.value) || w.value.startsWith("-")));
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
  const bodies = [];
  const heads = [];
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
      const last = lx.commands[lx.commands.length - 1]?.words;
      const compound = !!done.group && last?.length === 1 && OPENS.has(reserved[0] ?? "") && !HELD.has(reserved[0] ?? "");
      if (reserved.some((w) => HELD.has(w)) || compound)
        done.held = true;
      if (done.held || bodies.includes(true))
        done.kept = true;
      for (const [at, w] of reserved.entries()) {
        if (OPENS.has(w))
          bodies.push(HELD.has(w) || compound && at === 0);
        else if (CLOSES.has(w))
          bodies.pop();
      }
      const each = done.words[0]?.quoted ? undefined : done.words[0]?.value;
      const outer = heads.length === 0 && loops === 0;
      let head = heads.length > 0;
      for (const w of reserved) {
        if (w === "while" || w === "until" || w === "for" || w === "select")
          heads.push(w === "while" || w === "until");
        else if (w === "do")
          heads.pop();
        head ||= heads.length > 0;
      }
      if (each === "foreach")
        heads.push(false);
      else if (each === "end" && heads.length > 0 && !loop)
        heads.pop();
      if (loops > 0 || loop || head || each === "foreach")
        done.repeated = true;
      if (outer && !loop && reserved.some((w) => w === "while" || w === "until"))
        done.atLeastOnce = true;
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
      const from = lx.i;
      const text = c === "$" ? dollar(lx) : backtick(lx);
      merge(out, text);
      if (GLOB_CHARS.test(text.value))
        out.glob = true;
      const written = src.slice(from, lx.i);
      if (marked(text.value))
        merge(out, {
          splits: oneWord(written) || written.startsWith("$((") ? "sh" : "always",
          value: ""
        });
    } else if (c === "~" && lx.i === start && ends(next)) {
      out.value += homedir2();
      lx.i++;
    } else {
      if (c === UNKNOWN || c === READ)
        out.splits = "always";
      out.value += c;
      bare += c;
      lx.i++;
    }
  }
  if (/\{(?=[^{}]*\})[^{}]*(?:,|\.\.)/.test(bare))
    out.unknown ??= "a brace expansion";
  if (GLOB_CHARS.test(bare))
    out.glob = true;
  out.source = src.slice(start, lx.i);
  if (marked(out.value))
    out.raw = out.source;
  if (src[start] === "~" && TILDE.test(out.value))
    out.tilde = true;
  return out;
}
var GLOB_CHARS = /[*?[{(]/;
var TILDE = /^~[-+](?=\/|$|\u0000)/;
var ends = (c = "") => c === "" || c === "/" || BREAK.has(c);
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
    } else if (c === "$" || c === "`") {
      const from = lx.i;
      const text = c === "$" ? dollar(lx) : backtick(lx);
      merge(out, text);
      if (marked(text.value) && !QUOTED_ONE_WORD.test(src.slice(from, lx.i)))
        out.splits = "always";
    } else {
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
  const flagged = /[=~^]/.test(next) && /[A-Za-z_]/.test(src[lx.i + 2] ?? "");
  if (flagged || /[A-Za-z_]/.test(next)) {
    lx.i += flagged ? 2 : 1;
    const from = lx.i;
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
      } else if (wrapper === "env" && v === "-") {
        take();
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
  for (const [producer, { consumer, kind }] of codeFed(lexed.commands)) {
    producer.feedsShell = true;
    consumer.runsStdin = kind !== "code";
  }
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
  if (cmd.opaque) {
    env.cwdAnywhere = true;
    env.cwdSure = undefined;
    env.cwdUnread = true;
  }
  const [primary, ...others] = readings(parse(cmd));
  const expanded = expandTilde(cmd, primary.name, env);
  const before = others.length > 0 || expanded.length > 0 ? apart(env) : env;
  const verdict = await examineReading(cmd, primary, env, visit, builtins);
  if (verdict)
    return verdict;
  for (const parsed of others) {
    const verdict = await examineReading(cmd, parsed, apart(before), visit, builtins);
    if (verdict)
      return verdict;
  }
  for (const variant of expanded) {
    const verdict = await examineExpanded(cmd, variant, before, visit, builtins);
    if (verdict)
      return verdict;
  }
  if (!cmd.runsStdin || stdinScript(primary))
    return;
  const script = await stdinOf(cmd, env);
  return nested(cmd, env, () => run(lexScript(known(script), env), subshell(env), visit, builtins));
}
function stdinScript({ args, name }) {
  if (name === "." || name === "source")
    return STDIN_PATHS.has(args[0]?.value ?? "");
  if (!SHELLS.has(name))
    return false;
  const { inline, operand } = shellOperand(args, name);
  return !operand || !inline && STDIN_PATHS.has(operand.value);
}
var BLIND = "zsh's ~-, the folder the shell last left, which the hook cannot name on this line";
function expandTilde(cmd, name, env) {
  if (!env.old)
    return [];
  const opens = (w) => !!w?.tilde && TILDE.test(w.value);
  const moves = name === "cd" || name === "popd" || name === "pushd";
  const words = moves ? [] : cmd.words.filter(opens);
  const targets = cmd.redirects.filter((r) => opens(r.target));
  if (words.length === 0 && targets.length === 0)
    return [];
  const left = leftFolder(env);
  const lefts = cmd.kept ? [...left === undefined ? [] : [left], undefined] : [left];
  return lefts.map((dir) => {
    const expand = (w) => {
      if (!opens(w))
        return w;
      const rest = w.value.slice(2);
      if (w.value[1] === "+")
        return { ...w, tilde: undefined, value: `.${rest}` };
      return dir === undefined ? { ...w, tilde: undefined, unknown: BLIND, value: UNKNOWN + rest } : { ...w, tilde: undefined, value: dir + rest };
    };
    return {
      ...cmd,
      redirects: cmd.redirects.map((r) => opens(r.target) ? { ...r, target: expand(r.target) } : r),
      words: moves ? cmd.words : cmd.words.map(expand)
    };
  });
}
async function examineExpanded(cmd, expanded, before, visit, builtins) {
  const { redirects, words } = cmd;
  cmd.redirects = expanded.redirects;
  cmd.words = expanded.words;
  try {
    for (const parsed of readings(parse(cmd))) {
      const verdict = await examineReading(cmd, parsed, apart(before), visit, builtins);
      if (verdict)
        return verdict;
    }
  } finally {
    cmd.redirects = redirects;
    cmd.words = words;
  }
}
function leftFolder(env) {
  const left = env.oldFrom ?? (env.old?.dir === undefined ? [] : [env.old.dir]);
  return left.length === 1 ? left[0] : undefined;
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
    const bare = { ...cmd, bareOf: cmd, words: [] };
    verdict = await visit(bare, parse(bare), here);
    if (verdict)
      return verdict;
  }
  if (name === "") {
    for (const [key, value] of local)
      setVar(env.vars, key, value);
    if (builtins || cmd.feedsShell || rootFed(cmd))
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
  else if ((name === "source" || name === ".") && (args[0]?.procs || STDIN_PATHS.has(args[0]?.value ?? ""))) {
    const script = await scriptOf(args[0], cmd, here);
    verdict = (script.unknown ? await visit(cmd, parsed, here) : undefined) ?? await nested(cmd, env, () => run(again(lexScript(known(script), env), cmd, parsed), here, visit, builtins));
  } else if (name === "eval") {
    verdict = await nested(cmd, env, () => run(again(lexScript(args.map((a) => a.value).join(" "), env), cmd, parsed), here, visit, builtins));
  } else
    verdict = await visit(cmd, parsed, here);
  await record(cmd, name, args, here);
  return verdict;
}
function again(lexed, cmd, parsed) {
  if (!manyTimes(cmd, parsed))
    return lexed;
  const more = onceOrMore(cmd, parsed);
  for (const c of lexed.commands) {
    if (more && !c.repeated)
      c.atLeastOnce = true;
    c.repeated = true;
  }
  return lexed;
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
var onceOrMore = (cmd, parsed) => !!cmd.atLeastOnce && !cmd.chained && !cmd.detached && !cmd.kept && !cmd.unsure && (ownFirst(cmd, parsed.first) || throughBuiltin(cmd, parsed));
var throughBuiltin = (cmd, { first }) => {
  if (!first)
    return false;
  const before = cmd.words.slice(0, cmd.words.indexOf(first));
  return before.some((w) => !w.quoted && BUILTIN.has(w.value)) && before.every((w) => !w.quoted && (BUILTIN.has(w.value) || w.value.startsWith("-") || MARKERS.has(w.value) || ASSIGN.test(w.value)));
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
var tildeSign = (name, dir, env) => (name === "cd" || name === "pushd") && env.old && dir?.tilde && !dir.unknown && !dir.reads?.length ? dir.value[1] : undefined;
async function cdTarget(name, args, env) {
  const dir = args.find((a) => !(a.value.startsWith("-") && a.value.length > 1));
  if (!dir)
    return homedir2();
  const typed = dir.value === "-" ? undefined : await folder(pathOf(dir, env));
  const sign = typed ? undefined : tildeSign(name, dir, env);
  const base = sign && (sign === "-" ? env.old?.dir : env.cwd);
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
  for (const typed of dirs.length > 1 ? dirs : [dir]) {
    const word = env.hold?.(typed, cmd, env) ?? typed;
    if (word !== typed)
      unread = true;
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
function tildeMove(move, name, parsed, env, from, back) {
  const dir = parsed.args.find((a) => !(a.value.startsWith("-") && a.value.length > 1));
  const sign = tildeSign(name, dir, env);
  if (!sign || !dir)
    return move;
  const bases = sign === "-" ? back : from;
  const paths = [
    ...move.paths,
    ...bases.map((base) => base + dir.value.slice(2)),
    ...env.cwd === undefined ? [] : [env.cwd]
  ];
  return {
    back: move.back || sign === "-",
    paths: [...new Set(paths)],
    unread: move.unread || bases.length === 0
  };
}
async function chdirTo(name, cmd, parsed, env) {
  const left = env.cwd;
  env.cwd = name === "popd" || cmd.detached ? undefined : await cdTarget(name, parsed.args, env);
  if (env.old)
    env.old = name === "popd" ? {} : { dir: env.cwd === undefined ? undefined : left };
  if (env.old)
    env.oldFrom = [];
  const from = startFolders(env);
  const back = [...new Set([...env.cwdBack ?? [], ...from])];
  const bases = [...new Set([...from, ...env.cwdHeld ?? []])];
  const move = name === "popd" ? { back: true, paths: [], unread: true } : tildeMove(cdTargets(name, cmd, parsed, env, bases), name, parsed, env, from, back);
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
    if (env.old)
      env.oldFrom = bases;
    if (chained) {
      env.cwdChain = keep([...new Set([...env.cwdChain ?? [], ...from])], env);
      env.cwdChainToken = cmd.chain;
    }
    return;
  }
  env.cwdSure = undefined;
  const behind = onceOrMore(cmd, parsed) && !unread && !move.back && paths.length > 0 && (chained || (await Promise.all(paths.map(isFolder))).every(Boolean));
  env.cwdMaybe = keep([...new Set([...move.back ? back : behind ? [] : from, ...paths])], env);
  env.cwdUnread = env.cwdUnread || unread || from.length === 0 && paths.length === 0;
}
var negated = (cmd) => markers(cmd.words).filter((word) => word === "!").length % 2 === 1;
function unchain(cmd, env) {
  if (!env.cwdChain?.length || cmd.chain === env.cwdChainToken)
    return;
  env.cwdMaybe = keep([...new Set([...env.cwdMaybe ?? [], ...env.cwdSure ? [env.cwdSure] : [], ...env.cwdChain])], env);
  env.cwdSure = undefined;
  if (env.old)
    env.oldFrom = [];
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
  const splits = (script) => SPLITTERS.has(name) || name === "zsh" && (zshSplits(script) || args.some((a) => /^[-+]/.test(a.value) && a.value !== "-c"));
  if (operand && inline) {
    let script = operand.value;
    if (xargs?.replace && script.includes(xargs.replace)) {
      const fed = await stdinOf(cmd, env);
      script = filled(script, xargs.replace, fed.unknown ? UNKNOWN : fed.value.trim());
    }
    return run(lexScript(script, env), { ...subshell(env), splits: splits(script) }, visit, builtins);
  }
  const script = await scriptOf(operand, cmd, env);
  const text = known(script);
  return run(lexScript(text, env), { ...subshell(env), splits: splits(text) }, visit, builtins);
}
var known = (script) => script.value.replaceAll(UNKNOWN, `
`);
async function scriptOf(operand, cmd, env) {
  const script = !operand || STDIN_PATHS.has(operand.value) ? await stdinOf(cmd, env) : operand.procs ? await outputs(operand.procs, env) : unknown("a script file");
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
var feedsStdin = ({ fd, op }) => (fd === "" || fd === "0") && op.startsWith("<") && op !== "<&";
var rootFed = (cmd) => cmd.redirects.some(feedsStdin) && stdinShell(cmd) === "root";
async function stdinText(cmd, env) {
  const input = cmd.redirects.findLast(feedsStdin);
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

// scripts/hooks/steady.ts
var unquoted = (text) => text.replace(/\\\n|\$(?=["'])|["'\\]/g, "");
var READS_ONLY = /^(?:\}|:?[-+?]|[#%/])/;
var EVALUATES = [
  /\(\([^)]*[A-Za-z_]/,
  /\$\[[^\]]*[A-Za-z_]/,
  /\[\[.*\s-(?:eq|ge|gt|le|lt|ne)\s/s,
  /\$\{[#!]?\w+:(?![-+=?:])[^}]*[A-Za-z_]/,
  /@P\}/
];
var SUBSCRIPT = /\w\[(?!(?:[@*]|[-\d:,\s]*)\]|\^)/;
var INDIRECTS = /\$\{!(?!\}|[A-Za-z_]\w*(?:[*@]|\[[*@]\])\})/;
var QUALIFIER = /[^\s(|&;<>$=]\((?:#q)?[^()\s|]*?(?:e(?:\[[^]*?\]|\{[^]*?\}|<[^]*?>|([^\s[{<])[^]*?\1)|\+\w+)[^()\s]*\)(?=$|[\s;&|)<>`}])/;
function singleQuotesOut(command) {
  if (command.includes("$'"))
    return command;
  let out = "";
  let double = false;
  const docs = [];
  for (let i = 0;i < command.length; i++) {
    const c = command[i];
    if (c === "\\") {
      out += command.slice(i, i + 2);
      i++;
    } else if (double) {
      if (c === '"')
        double = false;
      out += c;
    } else if (c === '"') {
      double = true;
      out += c;
    } else if (c === "#" && (i === 0 || /[\s;&|(]/.test(command[i - 1]))) {
      const end = command.indexOf(`
`, i);
      const stop = end === -1 ? command.length : end;
      out += command.slice(i, stop);
      i = stop - 1;
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1)
        return command;
      out += "x";
      i = end;
    } else if (command.startsWith("<<<", i)) {
      out += "<<<";
      i += 2;
    } else if (command.startsWith("<<", i)) {
      const doc = command.slice(i).match(/^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([\w.-]+))/);
      if (!doc)
        return command;
      docs.push({ delim: doc[2] ?? doc[3] ?? doc[4], strip: doc[1] === "-" });
      out += doc[0];
      i += doc[0].length - 1;
    } else if (c === `
` && docs.length) {
      out += c;
      let at = i + 1;
      for (const { delim, strip } of docs) {
        for (;; ) {
          if (at > command.length)
            return command;
          const end = command.indexOf(`
`, at);
          const stop = end === -1 ? command.length : end;
          const line = command.slice(at, stop);
          out += command.slice(at, Math.min(stop + 1, command.length));
          at = stop + 1;
          if ((strip ? line.replace(/^\t+/, "") : line) === delim)
            break;
          if (end === -1)
            return command;
        }
      }
      docs.length = 0;
      i = at - 1;
    } else
      out += c;
  }
  return double || docs.length ? command : out;
}
var READ2 = /\$(?:[A-Za-z_]\w*|\{[A-Za-z_]\w*\})(?!\[)/.source;
var TEXT = /[^"$`\\]/.source;
var WORD = new RegExp(String.raw`^(?:(?:[\w./:=@%+,~-]|${READ2})+|'[^']*'|"(?:${TEXT}|${READ2})*")`);
var REDIRECT2 = /^(?:[<>]&(?:\d+|-)|<<<|&>>?|>>?\|?|<>?)/;
var KEEPS_PROGRAM = /^(?:builtin|command|do|elif|else|exec|if|nocorrect|noglob|then|time|until|while)$/;
var PROMPT_PARAM = /^(?:PS[0-4]|PROMPT[2-4]?|RPROMPT2?|RPS[12]|SPROMPT)(?!\w)/;
var QUOTED_DOC = /^<<(-?)[ \t]*((?:[\w.-]*(?:'[^'\n]*'|"[^"\n$`\\]*"|\\[\w.-])[\w.-]*)+)(?=[\s;&|<>]|$)/;
function quotedBodiesOut(command) {
  let out = "";
  const docs = [];
  let program = true;
  let target = false;
  let word = "";
  const endWord = () => {
    if (word && target)
      target = false;
    else if (word && !/^[A-Za-z_]\w*=/.test(word) && !KEEPS_PROGRAM.test(word))
      program = false;
    word = "";
  };
  for (let i = 0;i < command.length; ) {
    const rest = command.slice(i);
    let token;
    let doc = null;
    if (rest[0] === `
`) {
      endWord();
      out += `
`;
      i++;
      for (const { delim, strip } of docs)
        for (;; ) {
          if (i >= command.length)
            return command;
          const end = command.indexOf(`
`, i);
          const stop = end === -1 ? command.length : end;
          const line = command.slice(i, stop);
          const last = (strip ? line.replace(/^\t+/, "") : line) === delim;
          out += (last ? line : "") + (end === -1 ? "" : `
`);
          i = stop + 1;
          if (last)
            break;
        }
      docs.length = 0;
      program = true;
      continue;
    } else if (token = rest.match(/^[ \t]+/)?.[0])
      endWord();
    else if (token = rest.match(/^(?:&&|\|\||[;|])/)?.[0]) {
      endWord();
      program = true;
    } else if (rest.startsWith("<<") && !rest.startsWith("<<<")) {
      doc = rest.match(QUOTED_DOC);
      if (!doc)
        return command;
      if (/^\d+$/.test(word))
        word = "";
      endWord();
      token = doc[0];
      docs.push({
        delim: doc[2].replace(/\\(.)/g, "$1").replace(/["']/g, ""),
        strip: doc[1] === "-"
      });
    } else if (token = rest.match(REDIRECT2)?.[0]) {
      if (/^\d+$/.test(word))
        word = "";
      endWord();
      target = !/&(?:\d+|-)$/.test(token);
    } else if (token = rest.match(WORD)?.[0]) {
      word += token;
      if (program && !target && token.includes("$") && !/^[A-Za-z_]\w*=/.test(word))
        return command;
      if (PROMPT_PARAM.test(word))
        return command;
    }
    if (!token || docs.length && token.includes(`
`))
      return command;
    out += token;
    i += token.length;
  }
  return docs.length ? command : out;
}
function namings(command) {
  const counts = new Map;
  const plain = new Set;
  const add = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const text = quotedBodiesOut(command);
  let blind = EVALUATES.some((evaluates) => evaluates.test(text)) || SUBSCRIPT.test(text) || SUBSCRIPT.test(unquoted(text)) || QUALIFIER.test(singleQuotesOut(text)) || INDIRECTS.test(text);
  for (const [, flags, closed] of text.matchAll(/\$\{\(([^)]*)(\)?)/g))
    if (!closed || !/^[\w@~^=!*-]*$/.test(flags) || /[eP]/.test(flags))
      blind = true;
  for (const m of command.matchAll(/(\$\{[#!]?)?(?<![\w$])([A-Za-z_]\w*)/g)) {
    const [whole, expanded, key] = m;
    const next = command.slice(m.index + whole.length);
    if (expanded && READS_ONLY.test(next))
      continue;
    const assigns = next[0] === "=" ? "=" : undefined;
    const at = m.index + (expanded?.length ?? 0);
    if (!expanded && command[at - 1] === "-" && (at < 2 || /\s/.test(command[at - 2]))) {
      for (let k = 0;k < key.length - 1; k++)
        if (key[k] === "a" || key[k] === "v")
          add(key.slice(k + 1));
      continue;
    }
    add(key);
    if (!expanded && assigns === "=" && (at === 0 || /[\s;&|(]/.test(command[at - 1])))
      plain.add(key);
  }
  const from = [];
  let joined = "";
  for (let i = 0;i < command.length; i++)
    if (!'\\\'"'.includes(command[i])) {
      from.push(i);
      joined += command[i];
    }
  for (const m of joined.matchAll(/(?<![\w$])[A-Za-z_]\w*/g)) {
    const end = m.index + m[0].length - 1;
    if (from[end] - from[m.index] !== end - m.index)
      add(m[0]);
  }
  return { blind, counts, plain };
}
var SHELL_SETS = new Set([
  "ARGC",
  "BASH",
  "BASHOPTS",
  "BASHPID",
  "COLUMNS",
  "COPROC",
  "CPUTYPE",
  "DIRSTACK",
  "EGID",
  "EPOCHREALTIME",
  "EPOCHSECONDS",
  "ERRNO",
  "EUID",
  "FUNCNAME",
  "FUNCNEST",
  "GID",
  "GROUPS",
  "HISTCMD",
  "HOST",
  "HOSTNAME",
  "HOSTTYPE",
  "LINENO",
  "LINES",
  "LOGNAME",
  "MACHTYPE",
  "MAPFILE",
  "MATCH",
  "MBEGIN",
  "MEND",
  "OLDPWD",
  "OPTARG",
  "OPTIND",
  "OSTYPE",
  "PIPESTATUS",
  "PPID",
  "PWD",
  "RANDOM",
  "REPLY",
  "SECONDS",
  "SHELLOPTS",
  "SHLVL",
  "SRANDOM",
  "TRY_BLOCK_ERROR",
  "TRY_BLOCK_INTERRUPT",
  "TTY",
  "TTYIDLE",
  "UID",
  "USERNAME",
  "VENDOR",
  "ZCURSES_COLORS",
  "ZCURSES_COLOR_PAIRS",
  "ZPCRE_OP",
  "_",
  "aliases",
  "argv",
  "builtins",
  "commands",
  "dirstack",
  "dis_aliases",
  "dis_builtins",
  "dis_functions",
  "dis_functions_source",
  "dis_galiases",
  "dis_patchars",
  "dis_reswords",
  "dis_saliases",
  "epochtime",
  "errnos",
  "funcfiletrace",
  "funcsourcetrace",
  "funcstack",
  "functions",
  "functions_source",
  "functrace",
  "galiases",
  "history",
  "historywords",
  "jobdirs",
  "jobstates",
  "jobtexts",
  "keymaps",
  "langinfo",
  "mapfile",
  "match",
  "mbegin",
  "mend",
  "modules",
  "nameddirs",
  "options",
  "parameters",
  "patchars",
  "pipestatus",
  "reply",
  "reswords",
  "saliases",
  "signals",
  "status",
  "sysparams",
  "termcap",
  "terminfo",
  "userdirs",
  "usergroups",
  "widgets",
  "zcurses_attrs",
  "zcurses_colors",
  "zcurses_keycodes",
  "zcurses_windows",
  "zgdbm_tied"
]);
var SHELL_SETS_PREFIX = /^(?:BASH_|COMP_|READLINE_|ZFTP_|ZSH_|zsh_)/;
var TIED = new Set([
  "CDPATH",
  "FIGNORE",
  "FPATH",
  "HISTCHARS",
  "MAILPATH",
  "MANPATH",
  "MODULE_PATH",
  "PATH",
  "PROMPT",
  "PROMPT2",
  "PROMPT3",
  "PROMPT4",
  "PS1",
  "PS2",
  "PS3",
  "PS4",
  "PSVAR",
  "WATCH",
  "cdpath",
  "fignore",
  "fpath",
  "histchars",
  "mailpath",
  "manpath",
  "module_path",
  "path",
  "prompt",
  "psvar",
  "watch"
]);
function holdable(key, named, counts) {
  return counts.get(key) === 1 && named.plain.has(key) && !SHELL_SETS.has(key) && !SHELL_SETS_PREFIX.test(key) && !TIED.has(key);
}
var NONE = { has: () => false };
var NAME_SETTERS = new Set([
  "compgen",
  "declare",
  "export",
  "float",
  "getln",
  "getopts",
  "integer",
  "let",
  "local",
  "mapfile",
  "pcre_match",
  "print",
  "printf",
  "private",
  "read",
  "readarray",
  "readonly",
  "set",
  "shift",
  "stat",
  "strftime",
  "syserror",
  "sysopen",
  "sysread",
  "syswrite",
  "typeset",
  "unset",
  "vared",
  "wait",
  "zcurses",
  "zformat",
  "zgdbmpath",
  "zgetattr",
  "zlistattr",
  "zmodload",
  "zparseopts",
  "zpty",
  "zregexparse",
  "zselect",
  "zsocket",
  "zstat",
  "zstyle",
  "zsystem",
  "ztcp",
  "ztie",
  "zuntie"
]);
var PRINTS = new Set(["print", "printf"]);
var NUMERIC = new Set(["float", "integer"]);
var TYPESETS = new Set(["declare", "export", "local", "readonly", "typeset"]);
var RUNS_TEXT = new Set([
  ".",
  "alias",
  "autoload",
  "emulate",
  "enable",
  "eval",
  "fc",
  "mapfile",
  "r",
  "readarray",
  "sched",
  "source",
  "trap",
  "zmodload",
  "zregexparse",
  "zstyle"
]);
var TESTS = new Set(["[", "[[", "test"]);
var PLAIN_NAME = /^[A-Za-z_]\w*$/;
var EXPANDS = /\$(?![A-Za-z_]\w*|\{[A-Za-z_]\w*\})|`|[<>]\(/;
var BINARY = new Set([
  "!=",
  "-a",
  "-ef",
  "-eq",
  "-ge",
  "-gt",
  "-le",
  "-lt",
  "-ne",
  "-nt",
  "-o",
  "-ot",
  "<",
  "=",
  "==",
  "=~",
  ">"
]);
var testsAName = (args, expands) => args.some((w, k) => {
  const next = args[k + 1];
  if (w.value === "-v")
    return next !== undefined && !PLAIN_NAME.test(next.source ?? "");
  if (!expands)
    return false;
  if (EXPANDS.test(w.source ?? "$"))
    return true;
  if (!marked(w.value))
    return false;
  return !w.quoted || next !== undefined && next.value !== "]" && !BINARY.has(next.value);
});
var OPENS2 = new Set(["case", "for", "if", "select", "until", "while", "{"]);
var CLOSES2 = new Set(["done", "esac", "fi", "}"]);
var LEADS = new Set(["!", "coproc", "do", "elif", "else", "then", "time"]);
function steadyNames(named, commands) {
  if (named.blind || named.counts.has("IFS"))
    return () => NONE;
  const counts = new Map(named.counts);
  const parses = commands.map((cmd) => parse(cmd));
  for (const [at, cmd] of commands.entries()) {
    const { name } = parses[at];
    if (RUNS_TEXT.has(name) || marked(name))
      return () => NONE;
    const flagged = (letters) => cmd.words.some((w, k) => k > 0 && /^-[^-\s]/.test(w.value) && letters.test(w.value));
    if (NUMERIC.has(name) || TYPESETS.has(name) && flagged(/[EFin]/))
      return () => NONE;
    if (name === "let" && cmd.words.some((w, k) => k > 0 && /[A-Za-z_]/.test(w.value)))
      return () => NONE;
    if (name === "print" && flagged(/P/))
      return () => NONE;
    if (TESTS.has(name) && testsAName(parses[at].args, name !== "[["))
      return () => NONE;
    const loop = cmd.words.findIndex((w) => !w.quoted && (w.value === "for" || w.value === "select"));
    if (!NAME_SETTERS.has(name) && loop === -1)
      continue;
    const vNames = cmd.words.flatMap((w, k) => k > 0 && /^-[^-\s]*v/.test(w.value) ? [{ ...w, value: w.value.slice(w.value.indexOf("v") + 1) }, cmd.words[k + 1]] : []);
    const names = loop !== -1 ? [cmd.words[loop + 1]] : PRINTS.has(name) ? vNames : cmd.words;
    for (const word of names) {
      if (!word)
        continue;
      if (marked(word.value.split("=")[0]))
        return () => NONE;
      if (word.quoted && word.value.includes("["))
        return () => NONE;
      for (const key of word.value.match(/[A-Za-z_]\w*/g) ?? [])
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const set = new Map;
  const where = new Map;
  let chain = 0;
  let depth = 0;
  for (const [at, cmd] of commands.entries()) {
    if (cmd.follows !== "&&")
      chain++;
    where.set(cmd, { at, chain });
    const top = depth === 0 && cmd.scope === 0;
    for (let k = 0;k < cmd.words.length; k++) {
      const { quoted, value } = cmd.words[k];
      if (quoted)
        break;
      if (value === "function")
        k++;
      else if (OPENS2.has(value))
        depth++;
      else if (CLOSES2.has(value))
        depth--;
      else if (!LEADS.has(value))
        break;
    }
    if (depth < 0)
      return () => NONE;
    const always = !cmd.follows || cmd.follows === ";" || cmd.follows === "&";
    if (!top || cmd.detached || !always && cmd.follows !== "&&")
      continue;
    const [first] = cmd.words;
    if (!first || !ASSIGN.test(first.value) || parses[at].name !== "")
      continue;
    if (/^[A-Za-z_]\w*\+?=\(/.test(first.value))
      continue;
    for (const key of parses[at].local.keys())
      if (holdable(key, named, counts))
        set.set(key, always ? { at } : { at, chain });
  }
  return (cmd) => {
    const here = where.get(cmd);
    if (!here)
      return NONE;
    return {
      has: (key) => {
        const from = set.get(key);
        return !!from && from.at < here.at && (from.chain === undefined || from.chain === here.chain);
      }
    };
  };
}
function heldWord(word, env, steady) {
  return word.raw && marked(word.value) ? relexed(word.raw, heldVars(env, steady)) : undefined;
}
function relexed(raw, known) {
  const words = lex(raw, known).commands.at(-1)?.words ?? [];
  return words.length === 1 && !marked(words[0].value) ? words[0] : undefined;
}
function heldVars(env, steady) {
  const known = { ...env.known };
  for (const [key, text] of env.vars) {
    if (key === "TMPDIR" || !steady.has(key))
      continue;
    if (!text.unknown && !marked(text.value))
      known[key] = text.value;
    else if ("raw" in text && typeof text.raw === "string") {
      const again = relexed(text.raw, known)?.value;
      if (again?.startsWith(`${key}=`))
        known[key] = again.slice(key.length + 1);
    }
  }
  return known;
}
var held2 = (word, env, steady) => !marked(word.value) || !!heldWord(word, env, steady);

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
var RUNNER_TAKES = new Set(["--package", "-p"]);
var SED_VALUES = new Set(["--expression", "--file", "--line-length"]);
var EXPORTS2 = new Set(["declare", "export", "local", "readonly", "typeset"]);
if (false) {}

// scripts/hooks/no-extensions-write.ts
var shown = (word) => (word.raw ?? word.value).replaceAll(UNKNOWN, () => "$\u2026").replaceAll(READ, () => "$\u2026");
var ROUTE = "every guard reads its list and policy.json from there, so a session's write would change what a guard allows. A guard's list or setting changes only by the owner typing the playground command as a ! command in the dispatcher's terminal window, which runs without hooks: tell your lead, and the dispatcher hands the owner the command. A session writes nothing there by hand.";
var PRIVACY_KEYS = new Set(["factory.archiveRepo", "owner.names"]);
var PRIVACY = "at your login's scope, which Privacy on the Dashboard's Settings page saves";
var PRIVACY_ROUTE = "every guard reads policy.json from there, so a session's write would change what a guard allows: tell your lead, and the dispatcher asks the owner to save it in Privacy on the Dashboard's Settings page. A session writes nothing there by hand.";
var refuse = (what) => `no-extensions-write hook refuses ${what}: ${what.endsWith(PRIVACY) ? PRIVACY_ROUTE : ROUTE}`;
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
var FIND_WRITES = /^-(?:fls|fprint|fprint0|fprintf)$/;
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
var EXPORTS3 = new Set(["declare", "export", "local", "readonly", "typeset"]);
var REMOVERS = new Set(["find", "mv", "rm", "rmdir", "rsync", "unlink"]);
var GETOPT_REMOVERS = new Set(["mv", "rm", "rmdir", "unlink"]);
var RSYNC_PATHS = [
  "backup-dir",
  "log-file",
  "only-write-batch",
  "partial-dir",
  "temp-dir",
  "write-batch"
];
var RSYNC_FLAGS = new Set(["backup", "partial"]);
var RSYNC_TEMP = /^-[^-@BefMT]*T/;
var WRITERS = new Set(["cp", "dd", "install", "ln", "mkdir", "tee", "touch"]);
var GNU_NAMED = /^g(cp|dd|find|install|ln|mkdir|mv|rm|rmdir|tee|touch|unlink|xargs)$/;
var WRITER_TAKES = {
  cp: { gnu: "S", long: ["no-preserve", "sparse", "suffix"], short: "" },
  install: {
    bsd: "BDfhlMT",
    flags: ["strip"],
    gnu: "S",
    long: ["group", "mode", "owner", "strip-program", "suffix"],
    short: "gmo"
  },
  ln: { gnu: "S", long: ["suffix"], short: "" },
  mkdir: { long: ["mode"], short: "m" },
  mv: { gnu: "S", long: ["suffix"], short: "" },
  touch: { long: ["date", "reference", "time"], short: "Adrt" }
};
var DUPLICATE = /^(?:\d+|-)$/;
var writer = ({ op, target }) => [">", ">>", ">|", "<>"].includes(op) || op === ">&" && !DUPLICATE.test(target?.value ?? "");
var GLOB = /[*?[{(]/;
var RUNS = /^(?:EDITOR|GIT_[A-Z0-9_]+|HOME|LESSOPEN|PAGER|VISUAL|XDG_CONFIG_HOME)$/;
var GIT_TEXT = /^GIT_(?:AUTHOR|COMMITTER)_/;
var CLI = join5("packages", "scripts", "src", "playground", "cli.ts");
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
  return !!sub && (GIT_READS.has(sub) || sub === "worktree" && rest[0] === "list") && !before.some((w) => /^-c|^--(?:config-env|exec-path)/.test(w)) && !rest.some((w) => /^(?:--output|-O|--open-files-in-pager|--ext-diff|--textconv)/.test(w));
}
var GH_READS = new Set([
  "api",
  "issue list",
  "issue view",
  "pr list",
  "pr view",
  "run list",
  "run view",
  "search"
]);
var GH_API_SENDS = /^(?:-[^-=qt]*[FXf]|--(?:cache|field|input|method|raw-field)(?:=|$))/;
var GH_WEB = /^(?:-[^-=qt]*w|--web(?:=|$))/;
function ghFilters(parsed) {
  const { args, first, name } = parsed;
  const filters = new Set;
  if (name !== "gh" || !first || marked(first.value))
    return filters;
  const [verb, sub] = args.map((a) => a.value);
  const call = verb === "api" || verb === "search" ? verb : `${verb} ${sub}`;
  if (!GH_READS.has(call))
    return filters;
  if (verb === "api" && args.some((a) => GH_API_SENDS.test(a.value)))
    return filters;
  if (args.some((a) => GH_WEB.test(a.value)))
    return filters;
  for (let k = 0;k < args.length; k++) {
    const { value } = args[k];
    if (["-q", "--jq", "-t", "--template"].includes(value) && args[k + 1])
      filters.add(args[++k]);
    else if (/^(?:-[qt].|--(?:jq|template)=)/.test(value))
      filters.add(args[k]);
  }
  return filters;
}
function gitConfigs(args) {
  const configs = [];
  for (let k = 0;k < args.length; k++) {
    const { value } = args[k];
    if (value === "-c" && args[k + 1])
      configs.push(args[++k]);
    else if (value.startsWith("-c") && value.length > 2)
      configs.push(args[k]);
    else if (GIT_TAKES.has(value))
      k++;
    else if (!value.startsWith("-"))
      break;
  }
  return configs;
}
var after = (word, cut) => ({
  ...word,
  raw: word.raw?.startsWith(word.value.slice(0, cut)) ? word.raw.slice(cut) : undefined,
  value: word.value.slice(cut)
});
var splitIn = (word, splitting = false) => word.splits === "always" || word.splits === "sh" && splitting;
function writeTargets(name, args, gnu, posix = false, splitting = false) {
  const splits = args.filter((word) => splitIn(word, splitting));
  if (name === "dd")
    return [
      ...new Set([
        ...args.flatMap((word) => word.value.startsWith("of=") ? [after(word, 3)] : marked(word.value) && !/^[a-z]+=/.test(word.raw ?? word.value) ? [word] : []),
        ...splits
      ])
    ];
  const into = name === "cp" || name === "install" || name === "ln" || name === "mv";
  const takes = WRITER_TAKES[name];
  const operands = [];
  let folder;
  let folders = false;
  const maybe = [];
  const logs = [];
  for (let k = 0, options = true;k < args.length; k++) {
    const word = args[k];
    const { value } = word;
    if (into && gnu && options && marked(value))
      maybe.push(word);
    if (!options || value === "-" || !value.startsWith("-")) {
      operands.push(word);
      if (!gnu || posix)
        options = false;
    } else if (value === "--")
      options = false;
    else if (value.startsWith("--")) {
      const [, long, attached] = /^--([^=]*)(=?)/.exec(value) ?? [];
      if (into && "target-directory".startsWith(long))
        folder = attached ? after(word, long.length + 3) : args[++k];
      else if (name === "install" && "directory".startsWith(long))
        folders = true;
      else if (!attached && !takes?.flags?.includes(long) && takes?.long.some((take) => take.startsWith(long)))
        k++;
    } else
      for (let i = 1;i < value.length; i++) {
        const letter = value[i];
        if (name === "install" && letter === "d")
          folders = true;
        else if (into && letter === "t") {
          folder = i + 1 < value.length ? after(word, i + 1) : args[++k];
          break;
        } else if (takes?.short.includes(letter) || (gnu ? takes?.gnu : takes?.bsd)?.includes(letter)) {
          const rest = i + 1 < value.length;
          if (!gnu && name === "install" && letter === "M") {
            const log = rest ? after(word, i + 1) : args[k + 1];
            if (log)
              logs.push(log);
          }
          if (!rest)
            k++;
          break;
        }
      }
  }
  if (name === "ln" && !folder && operands.length === 1)
    return [{ quoted: false, value: "." }, ...splits];
  const targets = into && !folders ? folder ? [folder] : operands.slice(-1) : operands;
  const moved = into && !gnu && name !== "install" ? [] : splits;
  return [...new Set([...targets, ...maybe, ...logs, ...moved])];
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
  "slack.gatedSends",
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
  if (program(word.value) === "playground")
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
var AWK_RUNS = /system|getline|[>@]/;
var awkRuns = (program) => AWK_RUNS.test(program) || awkPipe(program);
var AWK_LEAD = /^\s*\/(?:[^\\/"[\n]|\\.)*\/(?=\s*(?:\{|$))/;
var AWK_MATCH = /~\s*(?:\/(?:[^\\/"[\n]|\\.)*\/|"[^"\\\n]*")/g;
function awkPipe(program) {
  if (!program.includes("|"))
    return false;
  return /["/#\\|]/.test(program.replace(AWK_LEAD, " ").replace(AWK_MATCH, " "));
}
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
var READ_ONLY_MODULES = /^(?:node:)?(?:assert|buffer|console|crypto|events|node:test|path|punycode|querystring|string_decoder|timers|url|util|zlib)$/;
var IMPURE = [
  /\bchild_process\b|\bexec(?:File)?(?:Sync)?\s*\(|\bspawn(?:Sync)?\s*\(|\bBun\s*\.\s*\$|\bBun\s*\.\s*spawn/,
  /\b(?:rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|write|writeSync|writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|cp|cpSync|copyFile|copyFileSync|symlink|symlinkSync|link|linkSync|truncate|truncateSync|ftruncate|chmod|chmodSync|chown|chownSync|utimes|utimesSync|createWriteStream|open|openSync)\s*\(|\bBun\s*\.\s*write\b/,
  /\beval\s*\(|\bnew\s+Function\b|\bimport\s*\(|\[[^\]]*\]\s*\(|\bprocess\s*\.\s*binding\b|\bglobalThis\b|\bglobal\s*\[/,
  /\\x[0-9a-fA-F]|\\u|\\[0-7]/
];
function pureCompute(source) {
  if (IMPURE.some((re) => re.test(source)))
    return false;
  const refs = [...source.matchAll(/\b(?:require|import)\s*\(\s*(["'`])([^"'`]*)\1\s*\)/g)];
  if (refs.some((m) => !READ_ONLY_MODULES.test(m[2])))
    return false;
  const statics = [...source.matchAll(/\bimport\b[^;]*?\bfrom\s*(["'`])([^"'`]*)\1/g)];
  return !statics.some((m) => !READ_ONLY_MODULES.test(m[2]));
}
var EVALUATES2 = new Set(["-e", "-ep", "--eval", "-p", "-pe", "--print"]);
function evalProgram({ args, name }) {
  if (name === "agent-browser") {
    for (let k = 0;k < args.length; k++) {
      const { value } = args[k];
      if (value === "eval")
        return args[k + 1];
      const option = args[k - 1]?.value ?? "";
      if (!value.startsWith("-") && !(option.startsWith("--") && !option.includes("=")))
        return;
    }
    return;
  }
  if (name !== "bun" && name !== "node")
    return;
  for (let k = 0;k < args.length; k++) {
    const { value } = args[k];
    if (EVALUATES2.has(value))
      return args[k + 1];
    if (/^--(?:eval|print)=/.test(value))
      return args[k];
    if (!value.startsWith("-"))
      return;
  }
}
function programLines({ args, first }, rooted) {
  if (!AWKS.has(program(first?.value ?? "")))
    return [];
  return (awkPrograms(args) ?? []).filter(({ value }) => rooted || awkRuns(value)).flatMap(({ value }) => [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]));
}
var SEDS = new Set(["gsed", "sed"]);
var literal = (w) => !w.glob && !marked(w.value);
var SED_FLAG = /^-[Enrsuz]+$|^--(?:null-data|posix|quiet|regexp-extended|separate|silent|unbuffered)$/;
var SED_BRACKET = String.raw`\[\^?\]?[^\]/[\n]*\]`;
var SED_BODY = String.raw`(?:[^/\\\n[]|\\.|${SED_BRACKET})*/`;
var SED_TEXT = String.raw`(?:[^/\\\n]|\\.)*/`;
var SED_ADDRESS = String.raw`(?:\d+|\$|/${SED_BODY})`;
var SED_ITEM = String.raw`[ \t]*(?:${SED_ADDRESS}(?:[ \t]*,[ \t]*(?:${SED_ADDRESS}|[+~]\d+))?[ \t]*!?[ \t]*)?(?:[=dlnNpPqQ]|s/${SED_BODY}${SED_TEXT}[giImMp0-9]*)[ \t]*`;
var SED_SCRIPT = new RegExp(String.raw`^${SED_ITEM}(?:[;\n]${SED_ITEM})*;?$`);
function sedReads(args) {
  const scripts = [];
  const operands = [];
  for (let k = 0;k < args.length; k++) {
    const { value } = args[k];
    if (value === "-e" || value === "--expression") {
      if (!args[k + 1])
        return false;
      scripts.push(args[++k]);
    } else if (value.startsWith("--expression="))
      scripts.push({ ...args[k], value: value.slice("--expression=".length) });
    else if (value === "--") {
      operands.push(...args.slice(k + 1));
      break;
    } else if (value.startsWith("-") && value !== "-") {
      if (!SED_FLAG.test(value))
        return false;
    } else
      operands.push(args[k]);
  }
  const read = scripts.length ? scripts : operands.slice(0, 1);
  return read.length > 0 && read.every((w) => literal(w) && SED_SCRIPT.test(w.value));
}
var PERL_FLAG = /^-[alnpw]*[eE]?$/;
var PERL_BODY = String.raw`(?:[^/\\\n@$(]|\((?![?*]\??\{)|\\.|\$(?=[/|)]))*/`;
var PERL_RE = `/${PERL_BODY}`;
var PERL_MATCH = String.raw`\$[1-9&](?![[{]|->)`;
var PERL_VALUE = String.raw`(?:"(?:[^"\\$@\n]|\\[nt"\\]|${PERL_MATCH})*"|\$[1-9&_])`;
var PERL_PRINT = String.raw`print(?:[ \t]+${PERL_VALUE}(?:[ \t]*,[ \t]*${PERL_VALUE})*)?(?:[ \t]+(?:for|if|unless|while)[ \t]+${PERL_RE}[gimsx]*)?`;
var PERL_SUB = String.raw`s/${PERL_BODY}(?:[^/\\\n@$]|\\.|${PERL_MATCH})*/[gimsx]*`;
var PERL_ITEM = String.raw`[ \t]*(?:${PERL_PRINT}|${PERL_SUB})[ \t]*`;
var PERL_SCRIPT = new RegExp(String.raw`^${PERL_ITEM}(?:;${PERL_ITEM})*;?[ \t]*$`);
var PERL_FILE = /^(?:-|[^\s|<>+&-][^|]*(?<!\s))$/;
function perlReads({ args, local }, env) {
  if ([...local.keys(), ...env.vars.keys()].some((key) => key.startsWith("PERL")))
    return false;
  const scripts = [];
  let k = 0;
  for (;k < args.length; k++) {
    const { value } = args[k];
    if (value === "--") {
      k++;
      break;
    }
    if (!value.startsWith("-") || value === "-")
      break;
    if (!PERL_FLAG.test(value))
      return false;
    if (/[eE]$/.test(value)) {
      if (!args[k + 1])
        return false;
      scripts.push(args[++k]);
    }
  }
  const files = args.slice(k);
  return scripts.length > 0 && scripts.every((w) => literal(w) && PERL_SCRIPT.test(w.value)) && files.every((w) => literal(w) && PERL_FILE.test(w.value));
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
  const base = program(first.value);
  if (AWKS.has(base)) {
    const programs = awkPrograms(args);
    return !!programs && programs.every(({ value }) => !marked(value) && !awkRuns(value));
  }
  if (["cat", "grep", "head", "tail", "wc"].includes(base))
    return reads(parsed, env);
  if (base === "git")
    return reads(parsed, env) && !args.some(({ value }) => marked(value));
  if (SEDS.has(base))
    return sedReads(args);
  if (base === "perl")
    return perlReads(parsed, env);
  if (base === "cut")
    return true;
  if (base === "gh") {
    const filters = ghFilters(parsed);
    return filters.size > 0 && args.every((a) => filters.has(a) || !/\s/.test(a.value));
  }
  if (base === "sort")
    return !args.some(({ value }) => /^-[a-zA-Z]*o|^--./.test(value));
  if (base === "uniq")
    return args.filter(({ value }) => value === "-" || !value.startsWith("-")).length <= 1;
  return false;
}
var passes = (cmd, env) => narrow(cmd, env) || reads(parse(cmd), env);
function rooted(commands) {
  if (codeFed(commands).size > 0)
    return true;
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
var IMPLICIT_SHELL = new Set(["exec", "execSync"]);
var SHELL_RUNNER = /\b(exec|execFile|execFileSync|execSync|spawn|spawnSync)\s*\(/g;
var SHELL_WORD = /(["']?)\bshell\b\1(\s*:\s*false\b(?=\s*[,})]))?/g;
function namesShell(text) {
  return [...text.matchAll(SHELL_WORD)].some((m) => !m[2]);
}
function skipSpace(src, k) {
  while (k < src.length && /\s/.test(src[k]))
    k++;
  return k;
}
function stringLiteral(src, i) {
  const quote = src[i];
  if (quote !== '"' && quote !== "'" && quote !== "`")
    return;
  let value = "";
  let k = i + 1;
  while (k < src.length && src[k] !== quote) {
    if (src[k] === "\\") {
      value += src[k + 1] ?? "";
      k += 2;
    } else
      value += src[k++];
  }
  if (quote === "`" && value.includes("${"))
    return;
  return { end: k + 1, value };
}
function commandString(src, open) {
  let value = "";
  let k = open;
  for (;; ) {
    k = skipSpace(src, k);
    const literal = stringLiteral(src, k);
    if (!literal)
      return;
    value += literal.value;
    k = skipSpace(src, literal.end);
    if (src[k] !== "+")
      break;
    k++;
  }
  return value;
}
function shellRunnerArgs(text) {
  const out = [];
  const childProcess = text.includes("child_process");
  const shell = namesShell(text);
  for (const m of text.matchAll(SHELL_RUNNER)) {
    const open = m.index + m[0].length;
    const command = commandString(text, open);
    if (command === undefined)
      continue;
    if (IMPLICIT_SHELL.has(m[1]) && childProcess || shell)
      out.push(command);
  }
  return out;
}
function runsOf(parsed, vars, whole, rootLine) {
  const { args, first, local } = parsed;
  const values = [...local.values(), ...vars].flatMap((text) => {
    tick();
    return text.unknown ? [] : [text.value];
  });
  for (const word of whole ? first ? [first, ...args] : args : [])
    for (const text of texts(word)) {
      values.push(text.value.replace(/^!/, ""));
      if (rootLine)
        values.push(...text.value.split("\\n"));
      values.push(...shellRunnerArgs(text.value));
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
  let scoped = false;
  for (let k = 0;k < rest.length; k++) {
    const word = rest[k];
    if (word !== undefined && switches.includes(word))
      dry ||= word === "--dry-run";
    else if (word?.startsWith("--")) {
      scoped ||= word.startsWith("--scope");
      k++;
    } else
      positional.push(word);
  }
  if (command === "settings") {
    if (verb !== "set" && verb !== "reset")
      return;
    const key = positional[0];
    if (unread || key === undefined)
      return `playground settings ${verb} with a word it cannot read`;
    if (!GUARD_KEYS.has(key))
      return;
    return PRIVACY_KEYS.has(key) && !scoped ? `playground settings ${verb} of ${key}, a key a guard reads, ${PRIVACY}` : `playground settings ${verb} of ${key}, a key a guard reads`;
  }
  if (verb === "accept")
    return "playground ext accept, the owner's own call: post it as an accept decision with bun run ask new (.agents/dashboard/asks.md), whose Approve has the dashboard run it with no role, since the CLI refuses an accept with PLAYGROUND_ROLE set";
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
async function inspect(raw, environment, unknown = false) {
  const { cwd, tool_input: toolInput, tool_name: tool } = JSON.parse(raw);
  const input = toolInput ?? {};
  const directory = typeof cwd === "string" ? cwd : undefined;
  const root = real(extensionsDir(dataDir(environment)));
  const home = environment.HOME || homedir3();
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
    const expanded = /^~(?:\/|$)/.test(file) ? join5(home, file.slice(1)) : file;
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
  const consumers = new WeakMap;
  const lexLine = (line, known) => {
    const out = lex(line, known);
    for (const cmd of out.commands)
      if (cmd.stdin)
        consumers.set(cmd.stdin, cmd);
    return out;
  };
  const feeds = (cmd, env) => {
    for (let next = consumers.get(cmd);next; next = consumers.get(next))
      if (!passes(next, env))
        return true;
    return cmd.redirects.some((r) => writer(r) && r.target?.value !== "/dev/null");
  };
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
        const folder = dir && dirname3(dir);
        if (folder && (inRoot(folder) || above(folder, true)))
          return `${text.value}, a glob in ${folder}`;
      }
    }
  };
  const placed = (word, env, steady) => pathOf(heldWord(word, env, steady) ?? word, { ...env, cwd: undefined }) !== undefined;
  const afterUnreadCd = (write) => `${write} after a cd to a folder the hook cannot read, which may be ${root}; cd to a literal path first, or name the path absolutely`;
  const seen = new Set;
  let steadyAt = () => NONE;
  let whole = false;
  let rootLine = false;
  const varsRead = new WeakMap;
  const varsJudged = new WeakMap;
  const since = (store, vars, key) => {
    const cursors = store.get(vars) ?? new Map;
    store.set(vars, cursors);
    const [keys, next] = varsSince(vars, cursors.get(key));
    cursors.set(key, next);
    return keys.flatMap((k) => {
      tick();
      return vars.get(k) ?? [];
    });
  };
  const visit = async (cmd, parsed, env) => {
    const slot = slotWords(parsed);
    if (slot)
      return slot.length === 0 ? undefined : examine({ ...cmd, words: slot }, env, visit, false);
    const { args, first, name, xargs } = parsed;
    const findutils = GNU_NAMED.exec(name)?.[1];
    if (first && (findutils === "find" || findutils === "xargs")) {
      const value = first.value.replace(new RegExp(`g${findutils}$`, "i"), findutils);
      if (!cmd.words.includes(first) || value === first.value)
        return refuse(`${name} written where the hook cannot read it as ${findutils}, inside env -S's string or with more after its name; run it as a word of its own, ${name} or ${findutils}`);
      const { words } = cmd;
      cmd.words = words.map((word) => word === first ? { ...word, value } : word);
      try {
        return await examine(cmd, env, visit, false);
      } finally {
        cmd.words = words;
      }
    }
    for (const here of places(env)) {
      const into = cmd.redirects.find((r) => r.target && writer(r) && (inRoot(pathOf(r.target, here)) || GLOB.test(r.target.value) && !!names(r.target, here, true)));
      if (into?.target)
        return refuse(`a write to ${pathOf(into.target, here)}`);
    }
    const blind = env.cwdAnywhere ? cmd.redirects.find((r) => r.target && writer(r) && pathOf(r.target, { ...env, cwd: undefined }) === undefined) : undefined;
    if (blind?.target)
      return refuse(`a write to ${blind.target.value} on a line that names more folders than the hook carries, since it cannot rule out ${root}; run it as a line of its own after a cd to a literal path`);
    const unplaced = env.cwdUnread ? cmd.redirects.find((r) => r.target && writer(r) && !placed(r.target, env, steadyAt(cmd))) : undefined;
    if (unplaced?.target)
      return refuse(afterUnreadCd(`a write to ${shown(unplaced.target)}`));
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
    const program = rootLine || cmd.scope !== 0 || feeds(cmd, env) ? undefined : evalProgram(parsed);
    const opaque = program && !program.glob && !marked(program.value) && pureCompute(program.value) ? program : undefined;
    const lines = runsOf(opaque ? { ...parsed, args: args.filter((w) => w !== opaque) } : parsed, vars, whole, rootLine);
    for (const raw of reader ? [] : [...script, ...lines]) {
      const line = xargs?.replace && fed ? filled(raw, xargs.replace, fed.unknown ? UNKNOWN : fed.value) : raw;
      if (seen.has(line))
        continue;
      seen.add(line);
      const verdict = await run(lexLine(line, env.known), { ...env, splits: true, vars: new Map }, visit, true);
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
    if (!first || EXPORTS3.has(name) || reader)
      return;
    const verb = name && !marked(name) ? name : "a program it cannot read";
    const tool = GNU_NAMED.exec(name)?.[1] ?? name;
    const gnu = tool !== name || first.value.includes("/gnubin/");
    const remover = REMOVERS.has(tool);
    const posix = gnu && (parsed.local.has("POSIXLY_CORRECT") || env.vars.has("POSIXLY_CORRECT"));
    if (env.cwdAnywhere)
      return refuse(`${verb} on a line that names more folders than the hook carries, since it cannot rule out ${root}; run it as a line of its own after a cd to a literal path`);
    const steady = steadyAt(cmd);
    const filters = whole ? new Set : ghFilters(parsed);
    for (const here of places(env)) {
      if (inRoot(here.cwd))
        return refuse(`${verb} run inside ${root}`);
      if (name === "git" && inRoot(gitCall(args, here).cwd))
        return refuse(`git on a clone in ${root}`);
      const unheld = (remover ? args : WRITERS.has(tool) ? writeTargets(tool, args, gnu, posix, here.splits) : []).find((word) => !held2(word, here, steady));
      if (unheld)
        return refuse(splitIn(unheld, here.splits) ? `${verb} on ${shown(unheld)}, a value the hook does not hold that the shell may split into several words; quote it ("$X") and hold it in the same call, or write the path literally` : `${verb} on ${shown(unheld)}, a value the hook does not hold; hold it in the same call (X=<path>; ${verb} "$X") or write the path literally`);
      if (name === "git") {
        const config = gitConfigs(args).find((word) => marked(word.value));
        if (config)
          return refuse(`git ${/^-c./.test(config.raw ?? config.value) ? "" : "-c "}${shown(config)}, a value built from a variable or a substitution; write the value literally in the call`);
        const { rest } = gitCall(args, here);
        const fromEnv = args.slice(0, args.length - rest.length - 1).find((word) => /^--config-env(?:=|$)/.test(word.value));
        if (fromEnv)
          return refuse(`git ${shown(fromEnv)}, which takes a config value from a variable the hook cannot read; write the value literally with git -c`);
        const scoped = runsVariable(here.vars) ? [...here.vars] : [];
        const variable = [
          ...parsed.local,
          ...scoped.filter(([key]) => !parsed.local.has(key))
        ].find(([key, value]) => RUNS.test(key) && !GIT_TEXT.test(key) && !held2({ ...value, quoted: false }, here, steady));
        if (variable)
          return refuse(`git with ${variable[0]} set to a value the hook does not hold, which git may run or read as config; write the value literally in the call`);
      }
      const scope = since(varsJudged, here.vars, `${here.cwd}\x00${remover}`);
      for (const value of [...parsed.local.values(), ...scope]) {
        const named = names({ ...value, quoted: false }, here, remover);
        if (named)
          return refuse(`${verb} with a variable on ${named}`);
      }
      const literal = !whole && narrow(cmd, here);
      for (const word of [first, ...args].filter((word) => word !== opaque).map((word) => heldWord(word, here, steady) ?? word)) {
        const text = quiet && /\s/.test(word.value) || filters.has(word) && !word.glob;
        if (text && !texts(word).some((t) => holds(t.value, here)))
          continue;
        const named = names(word, here, remover, literal);
        if (named)
          return refuse(`${verb} on ${named}`);
      }
      if (cmd.redirects.some((r) => r.body && holds(r.body.value, here)))
        return refuse(`${verb} with a script that names ${root}`);
      if (fed && remover && (fed.unknown || marked(fed.value)))
        return refuse(`${verb} under xargs fed by ${fed.unknown ?? "a value it cannot read"}, a value the hook does not hold; write the paths literally in the call`);
      if (fed) {
        const named = !fed.unknown && fed.value.split(/\s+/).filter(Boolean).map((value) => names({ quoted: false, value }, here, remover)).find(Boolean);
        if (named)
          return refuse(`${verb} under xargs on ${named}`);
      }
    }
    const end = args.findIndex((word) => word.value === "--");
    const option = (word) => /^-./.test(word.value);
    const stop = !GETOPT_REMOVERS.has(tool) || gnu && !posix ? -1 : tool === "unlink" && !gnu ? Number(args[0]?.value === "--") : args.findIndex((word) => !option(word));
    const values = tool === "mv" ? writeTargets(tool, args, gnu, posix, env.splits) : tool === "rsync" ? args.flatMap((word, k) => {
      const long = /^--([^=]+)=?/.exec(word.value);
      const path = long && !RSYNC_FLAGS.has(long[1]) && RSYNC_PATHS.some((name) => name.startsWith(long[1]));
      const cut = path ? long[0].length : RSYNC_TEMP.exec(word.value)?.[0].length;
      if (!cut)
        return [];
      if (cut < word.value.length)
        return [after(word, cut)];
      return args[k + 1] ? [args[k + 1]] : [];
    }) : tool === "find" ? args.flatMap((word, k) => FIND_WRITES.test(word.value) && args[k + 1] ? [args[k + 1]] : []) : [];
    const operands = remover ? [
      ...args.filter((word, k) => end !== -1 && k > end || stop !== -1 && k >= stop || !option(word)),
      ...values
    ] : WRITERS.has(tool) ? writeTargets(tool, args, gnu, posix, env.splits) : [];
    const loose = env.cwdUnread ? operands.find((word) => !placed(word, env, steady)) : undefined;
    if (loose)
      return refuse(afterUnreadCd(`${verb} on ${shown(loose)}`));
  };
  const named = namings(command);
  const known = knownVariables(command, environment, directory);
  const steered = Object.keys(known).filter((key) => named.counts.has(key));
  if (unknown)
    for (const key of steered)
      delete known[key];
  const lexed = lexLine(command, known);
  steadyAt = steadyNames(named, lexed.commands);
  const env = {
    cwd: directory,
    cwdSure: directory,
    files: new Map,
    known,
    old: { dir: directory },
    process: environment,
    splits: zshSplits(command),
    vars: new Map
  };
  rootLine = rooted(lexed.commands);
  whole = rootLine || wholeLine(lexed.commands, env);
  if (SCORE.test(unquoted(command)) && changesIdentity(lexed.commands))
    return refuse(SCORE_AS_OTHER);
  const verdict = await run(lexed, env, visit, true);
  if (verdict || unknown || steered.length === 0)
    return verdict;
  return inspect(raw, environment, true);
}
async function check(raw, environment = process.env, budget = 1e4) {
  try {
    return await withDeadline(budget, async () => inspect(raw, environment));
  } catch (error) {
    if (error instanceof RangeError)
      return refuse(TOO_LONG);
  }
}
if (false) {}

// scripts/hooks/no-extensions-write-worker.ts
self.onmessage = async (event) => {
  self.postMessage(await check(event.data.raw, event.data.environment));
};
