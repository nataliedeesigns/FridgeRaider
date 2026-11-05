// Bundle the app into one self-contained HTML file for hosting (e.g. as a claude.ai Artifact).
//   node scripts/build.js [outfile]     (default: dist/fridgeraider.html)
//
// Inlines the stylesheet and concatenates the ES modules in dependency order, stripping
// import/export statements. The output has no <html>/<head>/<body> wrapper, because the host
// adds its own document skeleton, and it drops the Print button, since hosted pages can't print.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const out = process.argv[2] || join(root, 'dist/fridgeraider.html');

const MODULES = ['src/data/ingredients.js', 'src/data/recipes.js', 'src/engine.js', 'src/app.js'];

function stripModuleSyntax(src) {
  return src
    .replace(/^import\s[\s\S]*?\sfrom\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+(?=(const|let|function|class|async)\b)/gm, '');
}

const html = read('index.html');
const title = html.match(/<title>(.*?)<\/title>/)[1];
const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
let body = html.match(/<body>([\s\S]*)<\/body>/)[1];
body = body
  .replace(/\s*<script type="module" src="src\/app\.js"><\/script>\s*/, '\n')
  .replace(/\s*<button[^>]*id="dlg-print"[\s\S]*?<\/button>/, '');

const js = MODULES.map((m) => `// ---- ${m} ----\n${stripModuleSyntax(read(m))}`)
  .join('\n')
  .replace(/^\$\('#dlg-print'\).*$/m, '');

const page = `<title>${title}</title>
<meta name="description" content="${description}" />
<meta name="claude:viewport-fit-sides" content="cover" />
<style>
${read('src/styles.css')}
</style>
${body.trim()}
<script type="module">
${js}
</script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`Wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
