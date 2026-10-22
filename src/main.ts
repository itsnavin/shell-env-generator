import './style.css';
import { exportEnv, identifier, MAX_BYTES, sample, sensitive, type Analysis, type Variable } from './analyzer';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<header class="topbar"><a class="brand" href="./" aria-label="Shellseed home"><span class="brand-icon" aria-hidden="true">$_</span> shellseed<span class="beta">LOCAL FIRST</span></a><a href="#guide">How it works <span aria-hidden="true">↗</span></a></header>
<main>
  <section class="hero">
    <div><p class="eyebrow"><span class="dot"></span> YOUR SCRIPT. YOUR BROWSER. NOTHING UPLOADED.</p><h1>Give your shell script<br>a <em>starting environment.</em></h1><p class="intro">Find the inputs. Make them yours. Export a reviewable <code>variables.env</code> — without running a single command.</p></div>
    <aside class="hero-note"><span class="note-icon" aria-hidden="true">⌘</span><strong>Not a script runner.<br>A better starting point.</strong><p>Static analysis finds likely inputs, not guaranteed behavior. You stay in control of every value.</p></aside>
  </section>
  <nav class="steps" aria-label="Workflow"><span class="active"><b>01</b> Bring your script</span><span id="step-review"><b>02</b> Review the inputs</span><span id="step-export"><b>03</b> Take your environment</span></nav>
  <div class="workspace">
    <section class="panel source-panel" aria-labelledby="source-heading">
      <div class="panel-head"><div><p class="eyebrow">THE STARTING POINT</p><h2 id="source-heading">Your shell script</h2></div><button class="text-button" id="example">Try an example</button></div>
      <label class="dropzone" id="dropzone" for="file"><span class="upload-symbol" aria-hidden="true">↑</span><strong>Drop a shell script here</strong><span>or <u>choose a local file</u></span><small>.sh, .bash or plain text · up to 256 KiB</small><input id="file" type="file" accept=".sh,.bash,.txt,text/plain,application/x-sh" /></label>
      <div class="editor-label"><label for="source">Or paste your script</label><span id="file-label">Bash / POSIX sh</span></div>
      <textarea id="source" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="#!/usr/bin/env bash&#10;&#10;echo &quot;Deploying to \${DEPLOY_ENV:?Set a test environment}&quot;&#10;echo &quot;$API_URL&quot;"></textarea>
      <div class="source-footer"><span id="size">0 B / 256 KiB</span><span>UTF-8 · CRLF accepted</span></div>
      <div class="actions"><button id="analyze" class="primary">Analyze script <span aria-hidden="true">→</span></button><button id="clear" class="secondary">Clear all</button></div>
      <p class="privacy-note"><span aria-hidden="true">◈</span> Files stay in browser memory. No accounts, APIs, analytics, or saved history. Your script is never executed.</p>
    </section>
    <section class="panel review-panel" aria-labelledby="review-heading">
      <div class="panel-head"><div><p class="eyebrow">MAKE IT YOURS</p><h2 id="review-heading">Environment inputs</h2></div><span class="pill" id="review-count">Waiting for script</span></div>
      <div id="status" role="status" aria-live="polite">Start with a script to discover its likely inputs.</div>
      <div id="empty" class="empty"><div class="empty-code" aria-hidden="true"><span>$</span> YOUR_NEXT_IDEA<br><span>$</span> A_PLACE_TO_START<br><span class="muted">$</span> <span class="cursor">_</span></div><h3>A little context goes a long way.</h3><p>Your variables will appear here with editable examples, source locations, and the assumptions behind them.</p><span class="empty-tag">01 INPUT → 02 REVIEW → 03 EXPORT</span></div>
      <div id="results" hidden>
        <div class="stats"><div><strong id="total">0</strong><span>discovered</span></div><div><strong id="included">0</strong><span>included</span></div><div><strong id="unresolved">0</strong><span>need review</span></div></div>
        <details class="warnings" open><summary id="warning-title">Analysis notes & limitations</summary><ul id="warnings"></ul></details>
        <div class="filters"><label class="sr-only" for="search">Search variable names</label><input id="search" type="search" placeholder="Search variables…" /><label class="sr-only" for="filter">Filter variables</label><select id="filter"><option value="all">All variables</option><option value="included">Included</option><option value="review">Needs review</option><option value="required">Required</option><option value="default">Has fallback</option><option value="assigned">Assigned / internal</option><option value="builtin">Shell-maintained</option></select></div>
        <div id="variables"></div>
        <form id="manual" class="manual"><label class="sr-only" for="manual-name">New variable name</label><input id="manual-name" placeholder="ADD_VARIABLE_NAME" maxlength="128" required pattern="[A-Za-z_][A-Za-z0-9_]*" /><button class="secondary" type="submit">+ Add input</button></form>
      </div>
    </section>
  </div>
  <section class="panel export-panel" aria-labelledby="export-heading">
    <div class="panel-head"><div><p class="eyebrow">A REVIEWABLE START, NOT A SAFETY GUARANTEE</p><h2 id="export-heading">Your environment, ready to refine.</h2></div><span class="file-badge">variables.env</span></div>
    <div class="export-grid"><div><p class="export-description">Literal single-quoted assignments for <strong>Bash / POSIX sh</strong>. This is a shell-sourceable file, not interchangeable with Docker or Node dotenv formats.</p><label class="check"><input id="export-prefix" type="checkbox" checked /> Include <code>export</code> for child processes</label><label class="check acknowledgement"><input id="acknowledge" type="checkbox" /> I reviewed the values and understand that the script can still delete files, use the network, or access credentials.</label><p id="export-status" role="status">Analyze a script before exporting.</p><div class="actions"><button id="download" class="primary" disabled>Download .env <span aria-hidden="true">↓</span></button><button id="copy" class="secondary" disabled>Copy contents</button></div><p class="hint">Unresolved values are labeled in the header. A checked review box is your decision, not validation of a value.</p></div><div class="preview-wrap"><div class="preview-heading"><span><span class="dot"></span> SHELL PREVIEW</span><span>LF · UTF-8</span></div><pre id="preview" tabindex="0" aria-label="Generated environment preview"># Your reviewed environment will appear here.</pre></div></div>
  </section>
  <section id="guide" class="guide">
    <div><p class="eyebrow">A SMALL GUIDE</p><h2>Set up thoughtfully.<br>Test deliberately.</h2><p>An environment file is only one piece of a script's behavior. A zero exit code doesn't prove that everything worked.</p></div>
    <div class="guide-content"><details open><summary>What does the analyzer understand?</summary><p>A locally bundled Tree-sitter Bash grammar parses Bash/sh syntax: expansions, defaults, declarations, functions, loops, quoted text, heredocs and command substitutions. Comments, single-quoted text, escaped dollars and special/positional parameters aren't treated as environment inputs.</p><p>Scope and assignment inference is deliberately conservative, not execution or full dataflow analysis. Dynamic names, arrays, arithmetic, sourced files, eval and runtime behavior need manual review. Invalid or unsupported syntax blocks export.</p></details><details><summary>Where do the example values come from?</summary><p>Name-based hints only: URLs use example.invalid; paths point to an uncreated relative test directory. Other inputs stay REVIEW_ME. Sensitive names get a clearly fake test-credential placeholder. Script literals are never copied into examples. Even a fake path or boolean can select dangerous behavior: review every assumption.</p></details><details><summary>How do I use variables.env?</summary><p>First review the script and the downloaded file. Put the file in a deliberate, trusted test directory. In Bash or POSIX sh, from that directory, load with <code>. ./variables.env</code>. Only the generated environment file is sourced; this app never runs the script. Exported variables reach child processes; unchecked export produces shell-local assignments.</p><p>Add <code>variables.env</code> to <code>.gitignore</code>; on Unix, restrict this environment file with <code>chmod 600 variables.env</code>. Do not commit credentials. Review untrusted scripts before any execution and use a disposable VM/container with restricted access; containers are not a perfect sandbox.</p></details><details><summary>Privacy, limits & file format</summary><p>No scripts leave this browser, and nothing is stored in localStorage, URLs, cookies, logs, or a database. App assets and parser WASM load from this same site. Clear all terminates the parser and clears in-memory UI state; your OS clipboard and downloaded files must be cleared separately.</p><p>Maximum 256 KiB, 400 variables, 50,000 syntax nodes and 8 seconds per analysis. Values containing newlines, CR or NUL cannot be exported. Downloads use LF line endings and literal shell quoting. No remote file resolution or remote analysis is available.</p></details></div>
  </section>
</main>
<footer><a class="brand" href="./"><span class="brand-icon" aria-hidden="true">$_</span> shellseed</a><span>Built for a thoughtful first run. Never an automatic one.</span><a href="https://github.com/itsnavin/shell-env-generator" rel="noreferrer">Source & documentation ↗</a></footer>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const source = $<HTMLTextAreaElement>('source');
const fileInput = $<HTMLInputElement>('file');
const acknowledge = $<HTMLInputElement>('acknowledge');
let variables: Variable[] = [];
let current = false;
let worker: Worker | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let fileGeneration = 0;
let blobUrl: string | undefined;
let blobTimer: ReturnType<typeof setTimeout> | undefined;

function status(message: string, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function stop() {
  generation++; worker?.terminate(); worker = undefined; clearTimeout(timer);
  $<HTMLButtonElement>('analyze').disabled = false;
  $('analyze').textContent = 'Analyze script →';
}
function revokeDownload() {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = undefined; clearTimeout(blobTimer);
}
function invalidate(message = 'Script changed. Analyze again to refresh the inputs.') {
  stop(); revokeDownload(); current = false; variables = [];
  acknowledge.checked = false;
  $('results').hidden = true; $('empty').hidden = false;
  $('review-count').textContent = 'Waiting for script';
  $('variables').replaceChildren(); $('warnings').replaceChildren();
  $('step-review').classList.remove('active'); $('step-export').classList.remove('active');
  status(message); updateExport();
}
function size() {
  const bytes = new TextEncoder().encode(source.value).length;
  $('size').textContent = `${bytes.toLocaleString()} B / 256 KiB`;
  return bytes;
}
function updateExport() {
  const generated = exportEnv(variables, $<HTMLInputElement>('export-prefix').checked);
  const included = variables.filter(v => v.included).length;
  $('included').textContent = String(included);
  $('unresolved').textContent = String(generated.unresolved);
  $('preview').textContent = current ? generated.text || '# Fix the export errors to preview this file.' : '# Your reviewed environment will appear here.';
  $('export-status').textContent = !current ? 'Analyze a script before exporting.' : generated.errors.length ? generated.errors.join(' ') : !included ? 'Include at least one variable to export.' : `${generated.unresolved} unresolved or unreviewed of ${included} included. ${acknowledge.checked ? 'Ready to export with this status in the header.' : 'Review and acknowledge before exporting.'}`;
  const disabled = !current || !included || !!generated.errors.length || !acknowledge.checked;
  $<HTMLButtonElement>('download').disabled = disabled;
  $<HTMLButtonElement>('copy').disabled = disabled;
  $('step-export').classList.toggle('active', !disabled);
}
function changed() { acknowledge.checked = false; revokeDownload(); updateExport(); }
function label(text: string, element: HTMLElement, className = 'check'): HTMLLabelElement {
  const l = document.createElement('label'); l.className = className;
  l.append(element, document.createTextNode(text)); return l;
}
function renderVariables() {
  const list = $('variables'); list.replaceChildren();
  const search = $<HTMLInputElement>('search').value.toLowerCase();
  const filter = $<HTMLSelectElement>('filter').value;
  const visible = variables.filter(v => v.name.toLowerCase().includes(search) && (filter === 'all' || (filter === 'included' ? v.included : filter === 'review' ? v.included && (!v.reviewed || /REVIEW_|REPLACE_WITH_/.test(v.value)) : v.kind === filter)));
  for (const v of visible) {
    const card = document.createElement('article'); card.className = `variable ${v.included ? '' : 'excluded'}`;
    const head = document.createElement('div'); head.className = 'variable-head';
    const include = document.createElement('input'); include.type = 'checkbox'; include.checked = v.included; include.setAttribute('aria-label', `Include ${v.name}`);
    include.onchange = () => { v.included = include.checked; card.classList.toggle('excluded', !v.included); changed(); };
    const title = document.createElement('code'); title.textContent = v.name;
    const titleWrap = document.createElement('div'); titleWrap.className = 'variable-title'; titleWrap.append(include, title);
    const badge = document.createElement('span'); badge.className = `kind kind-${v.kind}`; badge.textContent = `${v.kind === 'default' ? 'fallback' : v.kind} · ${v.confidence} confidence`;
    head.append(titleWrap, badge);
    const id = `value-${variables.indexOf(v)}`;
    const input = document.createElement('input'); input.id = id; input.type = v.sensitive ? 'password' : 'text'; input.value = v.value; input.autocomplete = 'off'; input.spellcheck = false;
    input.setAttribute('aria-label', `Test value for ${v.name}`);
    input.oninput = () => { v.value = input.value; v.reviewed = false; review.checked = false; changed(); };
    const valueWrap = document.createElement('div'); valueWrap.className = 'value-wrap'; valueWrap.append(input);
    if (v.sensitive) {
      const show = document.createElement('button'); show.type = 'button'; show.className = 'text-button'; show.textContent = 'Show'; show.setAttribute('aria-label', `Show or hide ${v.name}`);
      show.onclick = () => { input.type = input.type === 'password' ? 'text' : 'password'; show.textContent = input.type === 'password' ? 'Show' : 'Hide'; };
      valueWrap.append(show);
    }
    const assumption = document.createElement('p'); assumption.className = 'assumption'; assumption.textContent = v.assumption;
    const review = document.createElement('input'); review.type = 'checkbox'; review.checked = v.reviewed; review.setAttribute('aria-label', `Reviewed ${v.name}`);
    review.onchange = () => { v.reviewed = review.checked; changed(); };
    const details = document.createElement('details'); details.className = 'occurrences';
    const summary = document.createElement('summary'); summary.textContent = `${v.occurrences.length} source occurrence${v.occurrences.length === 1 ? '' : 's'} · reasons & context`;
    details.append(summary);
    for (const o of v.occurrences) {
      const p = document.createElement('p'); p.textContent = `Line ${o.line}:${o.column} · ${o.context} — ${o.reason}`; details.append(p);
    }
    if (!v.occurrences.length) { const p = document.createElement('p'); p.textContent = 'Manually added; not inferred from the script.'; details.append(p); }
    card.append(head, valueWrap, assumption, label(' I reviewed this example value', review), details); list.append(card);
  }
  if (!visible.length) { const p = document.createElement('p'); p.className = 'no-matches'; p.textContent = 'No variables match this view. Try another filter or add an input manually.'; list.append(p); }
  $('total').textContent = String(variables.length);
  $('review-count').textContent = `${variables.length} discovered`;
  updateExport();
}
function finish(result: Analysis) {
  stop();
  if (result.errors.length) { invalidate(result.errors.slice(0, 8).join(' ')); $('status').classList.add('error'); return; }
  variables = result.variables; current = true; $('empty').hidden = true; $('results').hidden = false;
  $('warnings').replaceChildren();
  for (const warning of result.warnings) { const li = document.createElement('li'); li.textContent = warning; $('warnings').append(li); }
  $('warning-title').textContent = `${result.warnings.length} analysis notes · review before use`;
  status(variables.length ? 'Analysis complete. Review every included value and the assumptions below.' : 'No named variables inferred. This is not proof that no runtime inputs are needed; add any missing inputs manually.');
  $('step-review').classList.add('active'); renderVariables();
}
source.addEventListener('input', () => { fileGeneration++; invalidate(); size(); });
$('analyze').onclick = () => {
  fileGeneration++; invalidate('Analyzing syntax locally…');
  if (!source.value.trim()) { status('Paste a script or choose a local file first.', true); source.focus(); return; }
  if (size() > MAX_BYTES) { status('Script exceeds 256 KiB. Choose a smaller script.', true); return; }
  if (source.value.includes('\0')) { status('NUL bytes are not supported. Choose a UTF-8 text shell script.', true); return; }
  $<HTMLButtonElement>('analyze').disabled = true; $('analyze').textContent = 'Analyzing…';
  const run = generation;
  worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ result?: Analysis; error?: string }>) => {
    if (generation !== run) return;
    if (event.data.result) finish(event.data.result);
    else { stop(); status(event.data.error ?? 'Analysis failed. Try a smaller Bash/sh script.', true); }
  };
  worker.onerror = () => { if (generation === run) { stop(); status('Local parser could not load. Reload the page and try again.', true); } };
  timer = setTimeout(() => { if (generation === run) { stop(); status('Analysis exceeded 8 seconds and was stopped. Reduce the script size or complexity.', true); } }, 8000);
  worker.postMessage(source.value.replaceAll('\r\n', '\n'));
};
async function load(file: File) {
  const run = ++fileGeneration; invalidate('Reading your local file…');
  source.value = ''; size(); $('file-label').textContent = 'Local file';
  if (file.size > MAX_BYTES) { status('File exceeds the 256 KiB limit. Choose a smaller script.', true); fileInput.value = ''; return; }
  try {
    const data = await file.arrayBuffer();
    if (run !== fileGeneration) return;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (text.includes('\0')) throw new Error('binary');
    source.value = text; size(); status('File loaded locally. Analyze its syntax to continue.'); source.focus();
  } catch { if (run === fileGeneration) status('Cannot read this file as UTF-8 text. Choose a plain text shell script.', true); }
  fileInput.value = '';
}
fileInput.onchange = () => { const file = fileInput.files?.[0]; if (file) void load(file); };
const dropzone = $('dropzone');
dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add('dragging'); };
dropzone.ondragleave = () => dropzone.classList.remove('dragging');
dropzone.ondrop = e => {
  e.preventDefault(); dropzone.classList.remove('dragging');
  if (e.dataTransfer?.files.length !== 1) { status('Choose exactly one local script at a time.', true); return; }
  void load(e.dataTransfer.files[0]);
};
$('clear').onclick = () => {
  fileGeneration++; invalidate('Cleared. Nothing is stored by this app.');
  source.value = ''; fileInput.value = ''; size();
  $('file-label').textContent = 'Bash / POSIX sh';
  $<HTMLInputElement>('search').value = ''; $<HTMLSelectElement>('filter').value = 'all';
  $<HTMLInputElement>('manual-name').value = ''; source.focus();
};
$('example').onclick = () => {
  fileGeneration++; invalidate('Example loaded. Analyze it to explore the review flow.');
  source.value = '#!/usr/bin/env bash\n# A static example. Shellseed never runs this.\nDEPLOY_ENV="${DEPLOY_ENV:?Choose a test environment}"\nAPI_URL="${API_URL:-https://example.invalid}"\nOUTPUT_DIR="${OUTPUT_DIR:-./shellseed-test}"\nMESSAGE="Preparing a test"\nprintf \'%s\\n\' "$MESSAGE: $DEPLOY_ENV, $API_URL, $OUTPUT_DIR"\n# A test credential must be supplied deliberately.\nprintf \'%s\\n\' "${API_TOKEN:?Use a disposable test credential}"\n';
  $('file-label').textContent = 'Built-in example'; size(); source.focus();
};
$('search').oninput = renderVariables; $('filter').onchange = renderVariables;
$('manual').onsubmit = e => {
  e.preventDefault(); const field = $<HTMLInputElement>('manual-name'); const name = field.value.trim();
  if (!identifier.test(name)) { status('Use a POSIX name: letters, digits and underscores, starting with a letter or underscore.', true); return; }
  if (variables.some(v => v.name === name)) { status('That variable already exists. Search for it to edit its value.', true); return; }
  if (variables.length >= 400) { status('The 400 variable limit has been reached.', true); return; }
  variables.push({ name, kind: 'external', confidence: 'low', occurrences: [], ...sample(name), included: true, reviewed: false, sensitive: sensitive(name) });
  field.value = ''; changed(); renderVariables(); status(`Added ${name}. Review its value before export.`);
};
acknowledge.onchange = updateExport;
$('export-prefix').onchange = changed;
$('download').onclick = () => {
  if ($<HTMLButtonElement>('download').disabled) return;
  revokeDownload();
  blobUrl = URL.createObjectURL(new Blob([exportEnv(variables, $<HTMLInputElement>('export-prefix').checked).text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = blobUrl; a.download = 'variables.env'; a.click();
  blobTimer = setTimeout(revokeDownload, 1000);
  $('export-status').textContent = 'Download requested: variables.env. Review it before loading into your shell.';
};
$('copy').onclick = async () => {
  if ($<HTMLButtonElement>('copy').disabled) return;
  const run = generation;
  try {
    await navigator.clipboard.writeText(exportEnv(variables, $<HTMLInputElement>('export-prefix').checked).text);
    if (run === generation) $('export-status').textContent = 'Environment copied. Clipboard is outside the app; clear it separately if needed.';
  } catch { if (run === generation) $('export-status').textContent = 'Clipboard access failed. Use Download instead.'; }
};
window.addEventListener('pagehide', () => { fileGeneration++; stop(); revokeDownload(); });
