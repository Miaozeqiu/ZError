import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(file) : /\.(ts|js)$/.test(file) && !file.endsWith('.d.ts') ? [file] : [];
});
const runtimeImport = node => {
  const clause = node.importClause;
  if (ts.isImportDeclaration(node)) {
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    return Boolean(clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)
      || clause.namedBindings.elements.some(item => !item.isTypeOnly));
  }
  if (node.isTypeOnly) return false;
  return !node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.some(item => !item.isTypeOnly);
};
export function serviceImportGraph(root = process.cwd()) {
  const files = walk(path.join(root, 'src/services'));
  const known = new Set(files);
  const graph = new Map();
  for (const file of files) {
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
    const edges = [];
    for (const node of ast.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier || !runtimeImport(node)) continue;
      const specifier = node.moduleSpecifier.text.split('?')[0];
      if (!specifier.startsWith('.')) continue;
      const base = path.resolve(path.dirname(file), specifier);
      const target = [base, base + '.ts', base + '.js', path.join(base, 'index.ts')].find(candidate => known.has(candidate));
      if (target && target !== file) edges.push(target);
    }
    graph.set(file, edges);
  }
  return graph;
}
export function staticServiceCycles(root = process.cwd()) {
  const graph = serviceImportGraph(root);
  let next = 0;
  const indexes = new Map(), low = new Map(), stack = [], active = new Set(), cycles = [];
  const visit = file => {
    indexes.set(file, next); low.set(file, next++); stack.push(file); active.add(file);
    for (const edge of graph.get(file) || []) {
      if (!indexes.has(edge)) { visit(edge); low.set(file, Math.min(low.get(file), low.get(edge))); }
      else if (active.has(edge)) low.set(file, Math.min(low.get(file), indexes.get(edge)));
    }
    if (low.get(file) === indexes.get(file)) {
      const group = []; let item;
      do { item = stack.pop(); active.delete(item); group.push(item); } while (item !== file);
      if (group.length > 1) cycles.push(group.map(file => path.relative(root, file)).sort());
    }
  };
  for (const file of graph.keys()) if (!indexes.has(file)) visit(file);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}
