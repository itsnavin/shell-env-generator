import { beforeAll, describe, expect, test } from 'vitest';
import { Language, Parser } from 'web-tree-sitter';
import { analyze, exportEnv, sample, type Variable } from '../src/analyzer';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let parser: Parser;
beforeAll(async () => {
  await Parser.init();
  parser = new Parser();
  parser.setLanguage(await Language.load('node_modules/tree-sitter-bash/tree-sitter-bash.wasm'));
});
function parse(source: string) {
  const tree = parser.parse(source)!;
  try { return analyze(tree.rootNode); } finally { tree.delete(); }
}
const names = (source: string) => parse(source).variables.filter(v => v.included).map(v => v.name);
const variable = (name: string, value: string): Variable => ({ name, value, kind: 'external', confidence: 'low', included: true, reviewed: true, sensitive: false, occurrences: [], assumption: 'test' });

describe('independently curated Bash/sh fixtures', () => {
  test('comments, quoting, escapes, positional and special parameters', () => {
    expect(names('# $COMMENT\nprintf \'$SINGLE\'\necho "\\$ESCAPED $DOUBLE" $PLAIN "$1 $@ $? $$ $! $0 ${10} ${#}"\n')).toEqual(['DOUBLE', 'PLAIN']);
  });
  test('nested fallback, non-colon operators and required values', () => {
    const result = parse('echo "${A:-${B}} ${C-default} ${D:=fallback} ${E?needed} ${F:?needed} ${G+alternative}"');
    expect(result.variables.map(v => [v.name, v.kind])).toEqual([['A', 'default'], ['B', 'external'], ['C', 'default'], ['D', 'default'], ['E', 'required'], ['F', 'required'], ['G', 'default']]);
  });
  test('assigned-only and assigned references are excluded but inspectable', () => {
    const result = parse('INTERNAL=fixed\nexport OTHER=fixed\nreadonly R=fixed\necho "$INTERNAL $OTHER $R $OUTSIDE"\n');
    expect(result.variables.filter(v => v.included).map(v => v.name)).toEqual(['OUTSIDE']);
    expect(result.variables.filter(v => v.kind === 'assigned').map(v => v.name)).toEqual(['INTERNAL', 'OTHER', 'R']);
  });
  test('self assignments and conditional fallbacks remain potential inputs', () => {
    expect(names('export KEEP="$KEEP"\nif test -z "$SWITCH"; then DEFAULT="${DEFAULT:-value}"; fi\n')).toEqual(['DEFAULT', 'KEEP', 'SWITCH']);
  });
  test('bare export and readonly may preserve existing environment inputs', () => {
    expect(names('export EXISTING\nreadonly CONFIG\nlocal INTERNAL\n')).toEqual(['CONFIG', 'EXISTING']);
    expect(parse('export EXISTING\n').variables[0].occurrences[0].reason).toContain('existing environment');
  });
  test('read/loops/functions are conservative and scope-aware', () => {
    const result = parse('read -r INPUT\nfor ITEM in "$LIST"; do echo "$ITEM $INPUT"; done\nf() { local LOCAL=word; echo "$LOCAL $ARG $1"; }\necho "$LOCAL"\n');
    expect(result.variables.filter(v => v.included).map(v => v.name)).toEqual(['ARG', 'LIST', 'LOCAL']);
    expect(result.warnings.join(' ')).toMatch(/scopes/);
    expect(result.warnings.join(' ')).toMatch(/read obtains/);
  });
  test('quoted and unquoted here-documents, CRLF normalization', () => {
    const script = "cat <<'EOF'\n$NOT_EXPANDED ${NOR_THIS}\nEOF\ncat <<EOF\n$EXPANDED ${FALLBACK:-word}\nEOF\n";
    expect(names(script)).toEqual(['EXPANDED', 'FALLBACK']);
    expect(names(script.replaceAll('\n', '\r\n').replaceAll('\r\n', '\n'))).toEqual(['EXPANDED', 'FALLBACK']);
  });
  test('substitutions parsed, not run; dynamic features explicitly warned', () => {
    const result = parse('echo "$(printf \'%s\' "$CMD_INPUT")" "${!POINTER}" "${ARRAY[INDEX]}"\nsource ./other.sh\neval "$RUNTIME"\nlocal -n ref=TARGET\n(( COUNTER += 1 ))\n');
    expect(result.variables.filter(v => v.included).map(v => v.name)).toEqual(['CMD_INPUT', 'RUNTIME']);
    for (const warning of ['Indirect', 'Arrays', 'External sourced', 'Runtime code', 'Substitutions', 'Nameref']) expect(result.warnings.join(' ')).toContain(warning);
  });
  test('builtins excluded; ordinary names remain visible', () => {
    const result = parse('echo "$HOME $PATH $PWD $USER $BASH_VERSION $CUSTOM_HOME"\n');
    expect(result.variables.filter(v => v.included).map(v => v.name)).toEqual(['CUSTOM_HOME']);
    expect(result.variables.filter(v => v.kind === 'builtin')).toHaveLength(5);
  });
  test('invalid syntax reports a location, not empty success', () => {
    const result = parse('if then\n');
    expect(result.errors.join(' ')).toMatch(/line 1, column/);
    expect(result.variables).toEqual([]);
  });
  test('script literals never enter generated defaults, contexts or warnings', () => {
    const result = parse('export API_TOKEN="${API_TOKEN:-fixture-embedded-credential}"\nHOST="${HOST:-internal.example.invalid}"\n');
    expect(JSON.stringify(result)).not.toContain('fixture-embedded-credential');
    expect(JSON.stringify(result)).not.toContain('internal.example.invalid');
    expect(result.variables.find(v => v.name === 'API_TOKEN')?.value).toBe('REPLACE_WITH_TEST_CREDENTIAL');
  });
  test('line numbers and reasons are preserved without source literals', () => {
    const v = parse('\n\nprintf "%s" "$INPUT"\n').variables[0];
    expect(v.occurrences[0]).toMatchObject({ line: 3, context: '$INPUT' });
    expect(v.occurrences[0].reason).toContain('likely external');
  });
  test('complex control flow and substitution operators preserve named inputs', () => {
    const script = [
      'case "$MODE" in',
      '  test) while test -n "$WAIT"; do printf "%s" "${VALUE/pattern/replacement}"; break; done ;;',
      '  *) : "${CONFIG:=fallback}" ;;',
      'esac',
      'printf "%s" "${LABEL#prefix}" "${LABEL%suffix}"',
    ].join('\n');
    expect(names(script)).toEqual(['CONFIG', 'LABEL', 'MODE', 'VALUE', 'WAIT']);
    expect(parse(script).errors).toEqual([]);
  });
  test('escaped unquoted heredoc dollars and here-string expansion', () => {
    expect(names('cat <<-EOF\n\t\\$LITERAL $EXPANDED\nEOF\ncat <<< "$HERE_STRING"\n')).toEqual(['EXPANDED', 'HERE_STRING']);
    expect(names('cat <<EOF\n\\${LITERAL:-$NESTED} \\\\$EVEN\nEOF\n')).toEqual(['EVEN', 'NESTED']);
  });
  test('variable limit is explicit rather than a truncated success', () => {
    expect(() => parse(Array.from({ length: 401 }, (_, i) => `A${i}=value`).join('\n'))).toThrow(/400 variables/);
  });
});

describe('literal shell-sourceable export', () => {
  test('identifier, duplicate and multiline validation', () => {
    for (const variables of [[variable('BAD-NAME', 'x')], [variable('A', 'x'), variable('A', 'y')], [variable('A', 'x\ny')], [variable('A', 'x\ry')], [variable('A', '\0')]]) {
      const output = exportEnv(variables, true); expect(output.errors.length).toBeGreaterThan(0); expect(output.text).toBe('');
    }
  });
  test('header reports unresolved, include/exclude and export semantics', () => {
    const a = variable('A', 'REVIEW_ME'); const b = variable('B', 'excluded'); b.included = false;
    const result = exportEnv([a, b], false);
    expect(result.unresolved).toBe(1); expect(result.text).toContain("A='REVIEW_ME'"); expect(result.text).not.toContain('B='); expect(result.text).not.toMatch(/^export/m);
  });
  test('examples are intentionally fake and unresolved', () => {
    expect(sample('SERVER_URL').value).toBe('https://example.invalid');
    expect(sample('OUTPUT_DIR').value).toBe('./shellseed-test/REVIEW_PATH');
    expect(sample('API_KEY').value).toBe('REPLACE_WITH_TEST_CREDENTIAL');
    expect(sample('SOME_FLAG').value).toBe('REVIEW_ME');
  });
  test('sh/bash syntax and literal roundtrip with inert injection payloads', () => {
    const folder = mkdtempSync(join(tmpdir(), 'shellseed-test-'));
    const payloads = ["single'quote", '$(touch MUST_NOT_EXIST)', '`touch MUST_NOT_EXIST`', '$HOME ${PATH}', 'semicolon; touch MUST_NOT_EXIST', 'double"quote', '', ' spaces \t stay ', '\\backslash', '#comment', 'Unicode café'];
    try {
      for (const shell of ['sh', 'bash']) {
        for (const payload of payloads) {
          const generated = exportEnv([variable('FIXTURE_VALUE', payload)], true);
          writeFileSync(join(folder, 'variables.env'), generated.text);
          const syntax = spawnSync(shell, ['-n', 'variables.env'], { cwd: folder, encoding: 'utf8' });
          expect(syntax.error).toBeUndefined(); expect(syntax.status).toBe(0);
          // Only our generated environment file is sourced, never any input fixture script.
          const result = spawnSync(shell, ['-c', '. ./variables.env; printf "%s" "$FIXTURE_VALUE"'], { cwd: folder, encoding: 'utf8' });
          expect(result.status).toBe(0); expect(result.stdout).toBe(payload);
          expect(existsSync(join(folder, 'MUST_NOT_EXIST'))).toBe(false);
        }
      }
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});
