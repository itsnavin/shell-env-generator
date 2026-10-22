import { Parser, Language } from 'web-tree-sitter';
import runtimeUrl from 'web-tree-sitter/tree-sitter.wasm?url';
import grammarUrl from 'tree-sitter-bash/tree-sitter-bash.wasm?url';
import { analyze, MAX_BYTES } from './analyzer';

self.onmessage = async (event: MessageEvent<string>) => {
  let parser: Parser | undefined;
  try {
    if (new TextEncoder().encode(event.data).length > MAX_BYTES) throw new Error('Script exceeds the 256 KiB limit.');
    await Parser.init({ locateFile: () => runtimeUrl });
    const language = await Language.load(grammarUrl);
    parser = new Parser(); parser.setLanguage(language);
    const tree = parser.parse(event.data);
    if (!tree) throw new Error('Parser could not read this script.');
    try { self.postMessage({ result: analyze(tree.rootNode) }); }
    finally { tree.delete(); }
  } catch (error) {
    self.postMessage({ error: error instanceof Error && /too complex|limit|400 variables/.test(error.message) ? error.message : 'Analysis failed. The local parser could not process this script. Try a smaller Bash/sh script.' });
  } finally { parser?.delete(); }
};
