import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

/** Candidate distribution files: tracked files plus non-ignored additions, never local .env/vaults. */
export function publicFiles(root = projectRoot) {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  return [...new Set(output.split('\0').filter(Boolean))].filter((file) => {
    const target = path.resolve(root, file);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Git devolvió una ruta fuera del proyecto.');
    let stat;
    try { stat = lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`No se distribuyen enlaces simbólicos: ${file}`);
    return stat.isFile();
  }).sort();
}
