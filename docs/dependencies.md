# bun audit

> [!NOTE]
> This file is the canonical record of dependency-audit overrides/exceptions (`bun audit --audit-level high` runs in the pre-push hook on canary). It intentionally exists even when no overrides are required, do not delete it.

> bun audit --level high

## Catalog ranges

Every `catalog` entry uses a caret range, and `.github/scripts/deps-manager.ts` enforces it on `postinstall`:

- An exact version (`1.2.3`), a partial (`4.7`, `5`) or a tilde (`~1.2.3`) is rewritten to a caret, and each change is printed under `[INFO] Normalized catalog ranges to caret`.
- Normalization runs _after_ the auto-move step, so a spec promoted into the catalog from a workspace dep is caught in the same run. That matters because `bun add` writes a workspace dep, and `bun add -E` writes an exact one.
- Anything it cannot convert safely is left untouched and reported under `[INFO] Catalog ranges that are not caret and cannot be converted safely`: compound ranges (`>=4.4.3 <5`), wildcards (`2.x`), and dist-tags (`latest`). Fix those by hand.
- Non-range specs are skipped silently, since a caret is meaningless for them: `workspace:`, `file:`, `link:`, `portal:`, `npm:` aliases, `github:owner/repo`, and git or http URLs.

Rewriting a spec after resolution leaves `bun.lock` holding the old spec string until the next install, so the first `bun install` after a pin fixes `package.json` but leaves the lockfile one step behind. A second `bun install` heals it. Committing the intermediate state is harmless: `bun install --frozen-lockfile` compares the resolved package set rather than the recorded spec, verified to pass in both directions without rewriting the lockfile. This matters because `auto-labeler.yml` installs with `--frozen-lockfile`.

Note that a caret on a prerelease widens it more than it may look: `^2.0.14-beta.1` admits `2.0.14-beta.2` and every later `2.x`. A prerelease is the one spec most often pinned on purpose, so if an exact prerelease matters, record the reason here before the rule rewrites it.

The rule has **no opt-out**, so no pin survives an install, whatever reason is recorded here. Pinning something deliberately means changing the rule itself in `.github/scripts/deps-manager.ts`, for example adding an allowlist it skips, and writing down why in this file. That was left out on purpose: there is nothing to exempt today, and an unused config key is worse than adding one when a real case appears.

Enforcement is only partial by design. Specs the rule cannot convert are reported and the script still exits 0, so a compound range such as `>=4.4.3 <5` survives an install with nothing but a line of `postinstall` output. Failing the install instead would block work for a range that may be perfectly deliberate, so the auto-convertible half is enforced and the rest is advisory.

## Active overrides

### `seroval` → `^1.6.8`

- **Advisory:** [GHSA-p6vx-979v-rg4c](https://github.com/advisories/GHSA-p6vx-979v-rg4c) (critical): `fromJSON()` Promise thenable assimilation invokes plugin-produced callables, a bypass of GHSA-mv8w-475r-vwqw; affects `>=0.12.0 <=1.6.0`. And [GHSA-jp82-f5mq-hwhp](https://github.com/advisories/GHSA-jp82-f5mq-hwhp) (high): memory exhaustion through an unchecked TypedArray length in JSON deserialization; affects `<=1.6.2`.
- **Why an override:** `@tanstack/query-devtools` brings in `solid-js` (`better-auth` lists it only as an optional peer), and `solid-js@1.9.15`, the latest stable, declares `seroval: ~1.5.4`, which `bun audit fix` reports as blocked by a dependent's range. The latest parents, `@tanstack/react-query-devtools@5.104.1` and `better-auth@1.7.7`, change nothing: the devtools still need `solid-js ^1.9.15`, and `solid-js` 2.x, which declares `seroval ~1.6.7`, is out of reach under that range. `seroval-plugins@1.5.6` stays, as its peer range is `seroval ^1.0`.
- **Risk:** low. Nothing here imports `solid-js` or better-auth's Solid client. It is installed for `@tanstack/query-devtools`, the Solid panel the web app mounts only outside production (`web/next/src/app/providers.tsx`). Only `solid-js/web`'s server build imports `seroval`, to serialize, and nothing here passes untrusted input to its `fromJSON`. `seroval-plugins@1.5.6` imports only `createPlugin`, which 1.6.8 keeps, and the suite, build and `bun run verify all` pass on it.
- **Exit criteria:** remove once the `solid-js` that `@tanstack/query-devtools` resolves declares a `seroval` range that resolves `>=1.6.3` on its own.

### `shell-quote` → `^1.11.0`

- **Advisory:** [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) (critical): `quote()` command injection via a line terminator in a token after a `{ comment }` token. Affects `shell-quote >=1.8.4 <1.11.0`.
- **Why an override:** `concurrently@10.0.5`, the latest, declares `shell-quote` at exactly `1.9.0`, so neither `bun update` nor a parent bump can lift it.
- **Risk:** low. `concurrently` runs only in `@api/hono`'s `dev:app` script, with commands written in its `package.json`, never untrusted input; `1.11.0` is a minor release of the same API, and `bun run test` and the build pass on it.
- **Exit criteria:** remove once `concurrently` declares a `shell-quote` range that resolves `>=1.11.0` on its own.

### `toml` → `^5.0.1`

- **Advisory:** [GHSA-4qx8-w7c3-pj3p](https://github.com/advisories/GHSA-4qx8-w7c3-pj3p), [GHSA-9j65-hcg3-gc64](https://github.com/advisories/GHSA-9j65-hcg3-gc64) and [GHSA-9qmh-m7c6-f92p](https://github.com/advisories/GHSA-9qmh-m7c6-f92p) (all high): CPU denial of service in `toml.parse()` through many array-of-tables headers, long dotted keys or table paths, and unbounded integer literals; each affects `toml <=5.0.0`. They follow [GHSA-82x6-q7mm-w9cf](https://github.com/advisories/GHSA-82x6-q7mm-w9cf) (high, `<4.2.0`) and [GHSA-v5mp-jgw5-2x6j](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j) (high, `<4.1.2`), which the earlier `^4.3.0` pin cleared.
- **Why an override:** `@lat.md/core@0.1.3`, the latest, depends on `@folder/xdg@4.0.1`, the latest, which declares `toml: ^3.0.0`, so neither `bun update` nor a parent bump can lift it, and the patch is a major above that range.
- **Risk:** low. `lat-core` calls `xdg()` only for its config and cache folders, and `@folder/xdg` parses TOML only when it expands a `.toml` file, which that path never does. `toml@5` keeps the CommonJS `parse` export `@folder/xdg` requires, and `lat-core check` passes on it.
- **Exit criteria:** remove once `@lat.md/core` resolves `toml >=5.0.1` on its own, or drops `@folder/xdg`.

## Patched dependencies

A patch lives in `patches/`, made with `bun patch <pkg>` and registered under `patchedDependencies` in the root `package.json`, which `turbo prune` carries into the Docker build.

### `next-themes@0.4.6`

- **Bug:** its `ThemeScript` renders the inline theme script on every render, so when React renders the root on the client (after a hydration mismatch, such as one a browser extension causes by adding a node), React 19 logs "Encountered a script tag while rendering React component" ([pacocoursey/next-themes#385](https://github.com/pacocoursey/next-themes/issues/385)).
- **Patch:** `ThemeScript` returns `null` when `window` exists, the change in the open [pacocoursey/next-themes#386](https://github.com/pacocoursey/next-themes/pull/386). The server's HTML still carries the script, so the theme is set before the first paint; `tests/patches/next-themes.test.ts` holds both halves.
  It relies on `NextThemesProvider` (`InnerProvider` in `web/next/src/app/providers.tsx`) staying a direct child of `<body>`, where React skips the server-only script while hydrating; inside a `<div>`, every load fails hydration (measured on Next 16.4.3 and React 19.3.1), and the test, which never hydrates, stays green.
- **Risk:** low. The patch is keyed to `0.4.6` exactly, so a bump of next-themes stops applying it, and the test's second case going red is what says so.
- **Exit criteria:** remove the patch, its `patchedDependencies` entry and its test once a next-themes version ships that pull request's fix or an equivalent one.

## Ignored advisories

An advisory with no patched version anywhere cannot be cleared by updating it, by updating a parent or by an override, so the gate ignores it by ID instead. Each `--ignore` sits in both gates, `lefthook.yml` and `.github/workflows/hosted-check-build.yml`. Remove it from both when its exit criteria are met.

### `braces` ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm))

- **Advisory:** high: stack-exhaustion denial of service through deeply nested brace patterns. Affects `braces <=3.0.3`, which is every published version; the advisory lists no patched version.
- **Why an ignore:** there is nothing to update to or override with. `braces@3.0.3` is the latest release, and every parent's latest still reaches it through `micromatch@4.0.8`: `shadcn@4.21.1` depends on `fast-glob` directly, and `globby@16.2.4` on both `fast-glob` and `micromatch`. The `ts-morph` path under `shadcn` would clear at `ts-morph@28` (its `@ts-morph/common` moved to `tinyglobby`), but `shadcn` still declares `ts-morph ^26` and its own `fast-glob`, so the tree keeps the copy either way.
- **Risk:** negligible. The only consumers are dev tooling: the `shadcn` CLI behind `bun run shadcn:update`, and `globby` in `.github/scripts/deps-manager.ts`, which globs the fixed pattern `**/package.json` on install. Neither takes a pattern from untrusted input, and nothing the api bundle or the web app ships imports the chain.
- **Exit criteria:** drop the ignore once `braces` publishes a patched version (then a normal `bun audit fix` or refresh lifts it), or once neither `shadcn` nor `globby` resolves `micromatch`.

## Retired overrides

The starter's own history of retired overrides lives in [nrjdalal/zerostarter's record](https://github.com/nrjdalal/zerostarter/blob/main/.github/notes/dependencies.md); a returning advisory is checked there before `package.json` changes.
