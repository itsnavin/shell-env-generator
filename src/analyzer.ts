import type { Node } from 'web-tree-sitter';

export const MAX_BYTES = 256 * 1024;
export const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const builtins = new Set(('HOME PATH PWD OLDPWD USER LOGNAME SHELL SHLVL IFS UID EUID PPID PID RANDOM SECONDS LINENO BASH BASH_VERSION BASH_VERSINFO BASH_SOURCE BASH_LINENO BASH_REMATCH BASHOPTS SHELLOPTS OSTYPE HOSTTYPE MACHTYPE HOSTNAME OPTARG OPTIND REPLY PIPESTATUS DIRSTACK GROUPS FUNCNAME _').split(' '));
export const sensitive = (name: string) => /secret|token|password|passwd|credential|private|api_?key|access_?key|auth|connection_?string|dsn/i.test(name);
export type Kind = 'required' | 'external' | 'default' | 'assigned' | 'builtin';
export interface Occurrence { line: number; column: number; context: string; reason: string }
export interface Variable {
  name: string; kind: Kind; confidence: 'medium' | 'low'; occurrences: Occurrence[];
  value: string; included: boolean; reviewed: boolean; sensitive: boolean; assumption: string;
}
export interface Analysis { variables: Variable[]; warnings: string[]; errors: string[] }
const children = (n: Node): Node[] => n.namedChildren.filter((child): child is Node => child !== null);

export function sample(name: string): { value: string; assumption: string } {
  if (sensitive(name)) return { value: 'REPLACE_WITH_TEST_CREDENTIAL', assumption: 'Sensitive name. Use a disposable test credential only; never copied from your script.' };
  if (/(url|uri|endpoint|host|domain)$/i.test(name)) return { value: /host|domain/i.test(name) ? 'example.invalid' : 'https://example.invalid', assumption: 'Reserved .invalid example address. No connection is attempted.' };
  if (/(dir|path|file|folder)$/i.test(name)) return { value: './shellseed-test/REVIEW_PATH', assumption: 'Uncreated relative test path. Review file operations; this path is not a safety boundary.' };
  if (/(port)$/i.test(name)) return { value: 'REVIEW_PORT', assumption: 'Choose an appropriate test port. No port is probed.' };
  return { value: 'REVIEW_ME', assumption: 'Purpose and value unknown. Supply an appropriate test value; no reliable default inferred.' };
}

export function analyze(root: Node): Analysis {
  const result: Analysis = { variables: [], warnings: [], errors: [] };
  const source = root.text;
  const warning = (s: string) => { if (!result.warnings.includes(s)) result.warnings.push(s); };
  const nodes: Node[] = [];
  const pending = [root];
  while (pending.length) {
    const n = pending.pop()!;
    nodes.push(n);
    if (nodes.length > 50000) throw new Error('Script is too complex. Reduce it to fewer than 50,000 syntax nodes.');
    if (n.type === 'ERROR' || n.isMissing) {
      result.errors.push(`Invalid or unsupported shell syntax at line ${n.startPosition.row + 1}, column ${n.startPosition.column + 1}.`);
    }
    pending.push(...children(n).reverse());
  }
  if (root.hasError) {
    if (!result.errors.length) result.errors.push('Invalid or unsupported shell syntax. Review the script before continuing.');
    return result;
  }
  const scope = (n: Node): number => {
    for (let p = n.parent; p; p = p.parent) if (p.type === 'function_definition' || p.type === 'subshell') return p.id;
    return root.id;
  };
  const assigned = new Map<string, Set<number>>();
  const bareDeclarations: Node[] = [];
  const mark = (name: string, n: Node) => {
    if (!identifier.test(name)) return;
    const scopes = assigned.get(name) ?? new Set<number>();
    scopes.add(scope(n)); assigned.set(name, scopes);
    if (assigned.size > 400) throw new Error('More than 400 variables found. Analyze a smaller script.');
  };
  for (const n of nodes) {
    if (n.type === 'variable_assignment') {
      const name = n.childForFieldName('name');
      if (name) mark(name.text, n);
    }
    if (n.type === 'declaration_command') {
      for (const child of children(n)) if (child.type === 'variable_name') {
        if (/^(export|readonly)\b/.test(n.text)) bareDeclarations.push(child);
        else mark(child.text, n);
      }
      if (/\s-[A-Za-z]*n/.test(n.text)) warning('Nameref declarations use runtime indirection. Add their actual inputs manually.');
    }
    if (n.type === 'for_statement' || n.type === 'c_style_for_statement') {
      const variable = n.childForFieldName('variable'); if (variable) mark(variable.text, n);
      warning('Loop and arithmetic bindings are conservative; ordering and iteration values are not inferred.');
    }
    if (n.type === 'command') {
      const command = n.childForFieldName('name')?.text;
      if (command === 'read') {
        warning('read obtains input at runtime; read targets are treated as assigned, not environment inputs.');
        for (const c of children(n).slice(1)) if (identifier.test(c.text)) mark(c.text, n);
      }
      if (command === 'source' || command === '.') warning('External sourced files are not resolved. Paste an independently reviewed combined script if needed.');
      if (command === 'eval' || command === 'bash' || command === 'sh' || command?.includes('$')) warning('Runtime code or dynamic commands may access variables that static analysis cannot discover.');
    }
    if (/array|subscript|arithmetic/.test(n.type)) warning('Arrays, subscripts, and arithmetic are not fully inferred. Review their variable dependencies manually.');
    if (n.type === 'command_substitution' || n.type === 'process_substitution') warning('Substitutions were parsed as syntax only, never executed. Their output and side effects are unknown.');
    if (n.type === 'function_definition' || n.type === 'subshell') warning('Function/subshell scopes are approximated; call order, arguments, dynamic scoping and assignment dataflow are not proven.');
  }
  const vars = new Map<string, Variable>();
  for (const n of nodes) {
    if (n.type !== 'simple_expansion' && n.type !== 'expansion') continue;
    // The Bash grammar emits expansion nodes for escaped heredoc dollars.
    // Correct only that lexical case; the AST still decides shell structure.
    let heredoc = false;
    for (let p = n.parent; p; p = p.parent) if (p.type === 'heredoc_body') { heredoc = true; break; }
    if (heredoc) {
      let slashes = 0;
      for (let i = n.startIndex - root.startIndex - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
      if (slashes % 2 === 1) continue;
    }
    if (n.type === 'expansion' && /^\$\{!/.test(n.text)) {
      warning('Indirect expansion or dynamic variable names cannot be resolved. Add the actual inputs manually.');
      continue;
    }
    const nameNode = children(n).find(c => c.type === 'variable_name');
    if (!nameNode || !identifier.test(nameNode.text)) continue;
    const name = nameNode.text;
    const suffix = n.text.slice(n.text.indexOf(name) + name.length);
    const required = /^:?\?/.test(suffix);
    const hasDefault = /^:?[=+-]/.test(suffix);
    const isAssigned = assigned.get(name)?.has(scope(n)) || assigned.get(name)?.has(root.id);
    let selfReference = false;
    for (let p = n.parent; p; p = p.parent) {
      if (p.type === 'variable_assignment') { selfReference = p.childForFieldName('name')?.text === name; break; }
    }
    const kind: Kind = builtins.has(name) || name.startsWith('BASH_') ? 'builtin' : required ? 'required' : hasDefault ? 'default' : selfReference ? 'external' : isAssigned ? 'assigned' : 'external';
    const reason = kind === 'builtin' ? 'Shell-maintained variable; excluded by default.' : kind === 'assigned' ? 'Also bound in this scope or global scope; possible internal variable. Ordering is not proven.' : kind === 'default' ? 'Default, assignment or alternate-value operator detected; necessity is not proven and script literals are not copied.' : kind === 'required' ? 'Parameter error operator requires review of the value.' : selfReference ? 'Assignment reads its existing environment value.' : 'No binding found in the approximated scope; likely external input.';
    let v = vars.get(name);
    if (!v) {
      const example = sample(name);
      v = { name, kind, confidence: kind === 'external' || kind === 'required' ? 'medium' : 'low', occurrences: [], value: example.value, assumption: example.assumption, sensitive: sensitive(name), included: kind !== 'builtin' && kind !== 'assigned', reviewed: false };
      vars.set(name, v);
      if (vars.size > 400) throw new Error('More than 400 variables found. Analyze a smaller script.');
    } else if (kind === 'required' || (kind === 'external' && v.kind !== 'required')) {
      v.kind = kind; v.included = true;
    }
    v.occurrences.push({ line: n.startPosition.row + 1, column: n.startPosition.column + 1, context: n.type === 'simple_expansion' ? `$${name}` : `\${${name}…}`, reason });
  }
  for (const n of bareDeclarations) {
    const name = n.text;
    if (!identifier.test(name)) continue;
    let v = vars.get(name);
    if (!v) {
      const example = sample(name);
      const kind: Kind = builtins.has(name) ? 'builtin' : assigned.has(name) ? 'assigned' : 'external';
      v = { name, kind, confidence: 'low', occurrences: [], ...example, sensitive: sensitive(name), included: kind === 'external', reviewed: false };
      vars.set(name, v);
    }
    v.occurrences.push({ line: n.startPosition.row + 1, column: n.startPosition.column + 1, context: `${name} (declaration)`, reason: 'Bare export/readonly may preserve an existing environment value; no value or definite dataflow inferred.' });
  }
  // Bindings without a reference remain inspectable, but never become inputs by default.
  for (const name of assigned.keys()) if (!vars.has(name)) {
    const example = sample(name);
    vars.set(name, { name, kind: builtins.has(name) ? 'builtin' : 'assigned', confidence: 'low', occurrences: nodes.filter(n => n.type === 'variable_name' && n.text === name).map(n => ({ line: n.startPosition.row + 1, column: n.startPosition.column + 1, context: `${name}=…`, reason: 'Declaration or runtime binding; no environment reference found.' })), ...example, sensitive: sensitive(name), included: false, reviewed: false });
  }
  for (const n of nodes) if (n.type === 'variable_assignment') {
    const name = n.childForFieldName('name');
    const v = name && vars.get(name.text);
    if (v && !v.occurrences.some(o => o.line === n.startPosition.row + 1 && o.column === n.startPosition.column + 1 && o.context === `${v.name}=…`)) {
      v.occurrences.push({ line: n.startPosition.row + 1, column: n.startPosition.column + 1, context: `${v.name}=…`, reason: 'Assignment binding. Its value is not copied; execution order and branch coverage are unknown.' });
    }
  }
  result.variables = [...vars.values()].sort((a, b) => Number(b.included) - Number(a.included) || a.name.localeCompare(b.name));
  if (result.variables.length > 400) throw new Error('More than 400 variables found. Analyze a smaller script.');
  warning('Static hints, not a dataflow proof: branches, runtime imports, aliases, namerefs and shell options can change which values are needed. Manually add missing inputs.');
  return result;
}

export function exportEnv(variables: Variable[], useExport: boolean): { text: string; errors: string[]; unresolved: number } {
  const included = variables.filter(v => v.included);
  const errors: string[] = [];
  const names = new Set<string>();
  for (const v of included) {
    if (!identifier.test(v.name)) errors.push(`Invalid POSIX environment name: ${v.name}`);
    if (names.has(v.name)) errors.push(`Duplicate variable: ${v.name}`);
    names.add(v.name);
    if (/[\r\n\0]/.test(v.value)) errors.push(`${v.name}: multiline, CR and NUL values are unsupported.`);
  }
  const unresolved = included.filter(v => !v.reviewed || /REVIEW_|REPLACE_WITH_/.test(v.value)).length;
  const lines = ['# Shellseed: shell-sourceable Bash/POSIX sh assignments, NOT a universal dotenv file.', '# Generated example values only. Review the script and every value before use.', `# Unresolved or unreviewed included values: ${unresolved}`, '# No script was executed. This file does not make a script safe.', ...included.map(v => `${useExport ? 'export ' : ''}${v.name}='${v.value.replaceAll("'", "'\\''")}'`), ''];
  return { text: errors.length ? '' : lines.join('\n'), errors, unresolved };
}
