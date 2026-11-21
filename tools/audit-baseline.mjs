// Parse historical JavaScript rather than treating control statements as functions.
import { parse } from 'acorn';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const commit = '65db5f5fd9b93bba796d027949c46f9b75c21d8e';
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', commit], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((f) => /^(src|tests|tools)\/.*\.(js|mjs)$/.test(f));
const functions = [];
for (const file of files) {
  const source = execFileSync('git', ['show', `${commit}:${file}`], { encoding: 'utf8' });
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  function visit(node, parent, key) {
    if (!node || typeof node !== 'object') return;
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    ) {
      const name =
        node.id?.name ||
        parent?.key?.name ||
        (parent?.type === 'VariableDeclarator' ? parent.id?.name : null) ||
        `anonymous@${node.loc.start.line}:${node.loc.start.column}`;
      functions.push({
        file,
        line: node.loc.start.line,
        column: node.loc.start.column,
        name,
        kind: node.type,
        signature: source
          .slice(
            parent?.type === 'MethodDefinition' ? parent.start : node.start,
            node.body?.start ?? node.end,
          )
          .trim()
          .replace(/\s+/g, ' '),
      });
    }
    for (const [k, v] of Object.entries(node))
      if (k !== 'loc') {
        if (Array.isArray(v)) for (const child of v) visit(child, node, k);
        else if (v && typeof v === 'object' && v.type) visit(v, node, k);
      }
  }
  visit(ast, null, null);
}
writeFileSync(
  'docs/biology/baseline-functions.json',
  JSON.stringify({ commit, functions }, null, 2) + '\n',
);
console.log(
  `Inventoried ${functions.length} real functions, including callbacks, in ${files.length} baseline modules.`,
);
