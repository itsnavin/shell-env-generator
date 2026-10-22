# Shellseed

A polished, browser-local shell environment generator. Upload or paste a Bash/sh
script, review likely inputs and intentionally fake examples, and download
**variables.env**. **The app never executes your script.**

**Live:** https://itsnavin.github.io/shell-env-generator/

## Workflow

1. Upload a local UTF-8 script or paste text (256 KiB maximum).
2. Analyze, then search/filter the discovered variables. Inspect occurrence line,
   column, redacted expansion context, inference reason, and confidence.
3. Edit test values, include/exclude inputs, or manually add missing variables.
   Review the warnings and acknowledge the risks before copy/download.

The name `variables.env` is intentional. This is a **shell-sourceable Bash/POSIX
sh file**, not a universal Node, Docker Compose, or other dotenv dialect.
No uploaded script text or embedded literals are copied into its comments.

## Privacy and safety

Analysis runs in a dedicated, terminable worker using locally bundled
**web-tree-sitter 0.25.10** and the maintained **tree-sitter-bash 0.25.1** WASM grammar.
There are no script-analysis APIs, remote scripts, analytics, fonts/CDNs,
LLMs, localStorage, sessionStorage, cookies, service workers or persistence.
Only static application/parser assets are loaded from the same origin.
Hosting providers still handle ordinary asset request metadata.

Scripts exist only in page/worker memory. Clear all empties the source/results,
terminates stale parsing, invalidates pending reads, and revokes download blob
URLs. Editing source invalidates results immediately. Clear cannot erase your
OS clipboard, downloaded files, browser/OS memory snapshots or browser extensions.
File names are not displayed or logged.

**Loading a script does not make it safe.** Scripts can delete files, contact
networks, or access credentials regardless of environment values. Sample paths
and flags can select destructive behavior. No values are certified harmless,
valid or sufficient; no script launcher is provided. A zero exit code is not
proof of correct functionality. Review all code and values, and use a disposable
VM/container with restricted privileges for untrusted code. Containers are not a
perfect sandbox.

## Parser support and inference limits

This is AST-based static analysis, not a regex pretending to parse shell or a
full control/dataflow engine. It targets the Bash/sh syntax accepted by
tree-sitter-bash, not fish, PowerShell, zsh-specific extensions, or every possible
Bash version/option. Syntax errors/unsupported grammar constructs are reported
with location and block export, rather than returning empty success.

Supported analysis includes `$VAR`, `${VAR}`, `${VAR:-fallback}`,
`${VAR-fallback}`, `${VAR:?message}`, `${VAR:=fallback}`, nested expansions,
assignments/export/readonly/local, read and loop bindings, function/subshell
scope approximations, double quotes, escaped dollars, single quotes/comments,
quoted/unquoted here-docs and substitutions. Substitutions are syntax only:
**never executed**. Positional/special parameters are excluded. Common
shell-maintained variables are visible but excluded by default.
A small AST-context lexical correction ignores odd-backslash-escaped dollars
in unquoted heredocs, which the bundled grammar otherwise emits as expansions.

Assigned-only/internal variables are visible and excluded by default.
Self-referential assignments and fallback/error expansions can still be
external inputs. Bindings are collected across a scope without proving
ordering, branches, calls, exports, or Bash dynamic scoping: a name assigned
later or only on one branch may still need an environment value. All inference
is medium/low confidence; use manual inclusion/addition when needed.

Indirect expansions, namerefs, arrays, arithmetic, eval/runtime shell commands,
and external `source` files receive explicit warnings. Their dependencies and
values are not fully inferred. External files are never fetched or resolved;
review and combine relevant source yourself. Function arguments and runtime
generated variables need manual review. The parser's successful parse does not
prove the script will run on your target shell.

Limits: 256 KiB UTF-8, 50,000 syntax nodes, 400 variables, 8-second worker timeout.
Input CRLF is normalized for parsing. Export rejects CR, LF and NUL in values.

## Example values and export

Name-only heuristics use `example.invalid` for URL/host hints, an **uncreated**
`./shellseed-test/REVIEW_PATH` for paths, `REPLACE_WITH_TEST_CREDENTIAL` for
sensitive names, and `REVIEW_ME`/`REVIEW_PORT` for unknown values. There is no
network probing and no randomly generated plausible credential. Sensitive-name
detection is a heuristic, not secret detection; values you enter appear in the
preview and download. Embedded defaults are deliberately never copied, even
when they appear harmless.

Every generated file contains its unresolved/unreviewed count. Marking a value
reviewed does not resolve a remaining `REVIEW_`/`REPLACE_WITH_` placeholder.
Unresolved exports are allowed only after explicit acknowledgement and remain
labeled. Required means a parameter error operator was detected, not complete
proof that the variable is always required.

Values are quoted as shell literals (`'` becomes `'\''`); dollar signs,
backticks, command substitutions and metacharacters remain data. Identifiers
must be POSIX names and duplicate included names are rejected. UTF-8 output
uses LF. Optional `export` controls inheritance to child processes.

Inspect the environment file and script first. In a **deliberate trusted test
directory**, load the reviewed environment with:

```sh
. ./variables.env
```

This only loads the environment file. It does not execute your script.
Add `variables.env` to `.gitignore`; on Unix protect the environment file with
`chmod 600 variables.env`. Never commit real credentials.

## Development and verification

Requires Node.js 22.12+ (CI uses 24), npm, and `sh`/`bash` for export roundtrip
tests. On Windows Git for Windows provides both shells; use `npm.cmd` if
PowerShell's policy does not allow the npm PowerShell shim.

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Open the URL printed by Vite, with `/shell-env-generator/`. No backend needed.
Unit fixtures use independently curated expectations for quoting, expansion
operators, assignments, scopes, heredocs, dynamic constructs, builtins and
invalid syntax. Roundtrip tests source **only generated environment files**
in controlled temporary directories, use inert payloads, and run `sh -n` /
`bash -n`. They never execute uploaded or fixture input scripts.
Playwright covers desktop/mobile upload, review/edit/include/exclude, filters,
manual inputs, invalid syntax, download, clipboard failure, reset/stale parsing,
size limits, no storage, no cross-origin requests, responsive overflow and
automated axe WCAG A/AA checks in initial and review states. Automated checks do
not replace testing with assistive technology.
On managed hosts that inject a system web-filter into test browsers,
`BROWSER_INJECTED_HOST` may explicitly identify that host for request attribution.
CI sets no such exception. This does not disable the filter or permit app network
requests to other origins; browser extensions/system software remain outside
the application's privacy boundary.

## Publishing

GitHub Pages uses Actions, not a branch folder. `.github/workflows/pages.yml`
builds and runs unit + desktop/mobile browser tests before uploading `dist` and
deploying `main`. Enable Pages with source **GitHub Actions** in repository
Settings. Vite's base is `/shell-env-generator/`. To verify the deployed app:

```sh
LIVE_URL=https://itsnavin.github.io/shell-env-generator/ npm run test:browser
```

On PowerShell set `$env:LIVE_URL` before the command instead.

## Licenses

Application: MIT. Bundled Tree-sitter runtime and Bash grammar: MIT; license
notices ship with the site as `THIRD_PARTY_NOTICES.txt`. Exact dependencies and
integrity hashes are in `package-lock.json`; development dependency license
texts are included by their npm packages.
