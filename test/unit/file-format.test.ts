// The file viewer's formats (src/renderer/brain/lib/file-format.ts): the view per type, highlight.js lines that stay
// balanced across multi-line tokens, CSV/TSV parsing, pretty JSON.
import{expect,it}from'vitest';
import{extOf,fmtBytes,highlightLines,languageOf,parseCsv,prettyJson,splitHighlighted,viewOf}from'../../src/renderer/brain/lib/file-format';
it('picks a view and a language from the path, dotfiles and Dockerfile included',()=>{
 expect(viewOf('C:/a/README.md')).toBe('markdown');expect(viewOf('/x/data.TSV')).toBe('csv');expect(viewOf('log.jsonl')).toBe('jsonl');expect(viewOf('a.json')).toBe('json');expect(viewOf('a.ts')).toBe('code');
 expect(extOf('C:\\repo\\.env')).toBe('env');expect(languageOf('C:\\repo\\.env')).toBe('ini');expect(languageOf('/r/Dockerfile')).toBe('dockerfile');
 expect(languageOf('x.yaml')).toBe('yaml');expect(languageOf('x.ps1')).toBe('powershell');expect(languageOf('notes.txt')).toBeNull();
});
it('splits highlighted HTML into self-contained lines',()=>{
 expect(splitHighlighted('<span class="c">/* a\nb */</span> x\ny')).toEqual(['<span class="c">/* a</span>','<span class="c">b */</span> x','y']);
 expect(splitHighlighted('a\r\nb')).toEqual(['a','b']);
});
it('highlights a known language lazily, escaping the text, and leaves unknown types alone',async()=>{
 const lines=await highlightLines('const a = "<b>";\n// done','x.ts');
 expect(lines).toHaveLength(2);expect(lines![0]).toContain('hljs-keyword');expect(lines![0]).toContain('&lt;b&gt;');expect(lines![1]).toContain('hljs-comment');
 expect(await highlightLines('plain','notes.txt')).toBeNull();
});
it('parses CSV with quotes and guesses the delimiter',()=>{
 expect(parseCsv('a,b\n1,"x, ""y"""\n')).toEqual([['a','b'],['1','x, "y"']]);
 expect(parseCsv('a;b\r\n1;"two\nlines"')).toEqual([['a','b'],['1','two\nlines']]);
 expect(parseCsv('a\tb\n1\t2','t.tsv')).toEqual([['a','b'],['1','2']]);
 expect(parseCsv('\uFEFFid,name\n1,x')[0]).toEqual(['id','name']);
});
it('pretty-prints JSON or says it does not parse; sizes read as people say them',()=>{
 expect(prettyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');expect(prettyJson('{oops')).toBeNull();
 expect(fmtBytes(512)).toBe('512 B');expect(fmtBytes(1_000_000)).toBe('977 KB');expect(fmtBytes(5*1024*1024)).toBe('5.0 MB');
});
