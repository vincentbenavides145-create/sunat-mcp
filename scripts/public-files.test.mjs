import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('publication guard catches tracked private files even when gitignore excludes their untracked copies', () => {
  const temp = path.resolve(os.tmpdir());
  const root = mkdtempSync(path.join(temp, 'sunat-publication-test-'));
  const relative = path.relative(temp, root);
  assert.match(relative, /^sunat-publication-test-[^/\\]+$/);
  try {
    mkdirSync(path.join(root, 'scripts'));
    for (const name of ['public-files.mjs', 'check-public-files.mjs']) copyFileSync(new URL(name, import.meta.url), path.join(root, 'scripts', name));
    execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'pipe' });
    writeFileSync(path.join(root, '.gitignore'), '.env\n*.db\n');
    writeFileSync(path.join(root, '.env.example'), 'EXAMPLE=\n');
    writeFileSync(path.join(root, '.env'), 'SYNTHETIC=private-placeholder\n');
    writeFileSync(path.join(root, 'example.db'), 'synthetic test bytes');
    const check = () => spawnSync(process.execPath, ['scripts/check-public-files.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(check().status, 0);
    execFileSync('git', ['add', '--force', '.env', 'example.db'], { cwd: root, stdio: 'pipe' });
    const refused = check();
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /\.env:|example\.db:/);
    assert.doesNotMatch(refused.stderr, /private-placeholder|synthetic test bytes/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
