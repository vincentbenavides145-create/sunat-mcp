import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectRoot, publicFiles } from './public-files.mjs';

// Official release assets, verified through the GitHub release API on 2026-10-25.
const version = '8.30.1';
const assets = {
  'win32-x64': ['windows_x64.zip', 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e'],
  'win32-arm64': ['windows_arm64.zip', 'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f'],
  'linux-x64': ['linux_x64.tar.gz', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'],
};
const asset = assets[`${process.platform}-${process.arch}`];
if (!asset) throw new Error('La revisión de secretos está preparada para Windows x64/ARM64 y Linux x64.');
const tempRoot = path.resolve(os.tmpdir());
const directory = mkdtempSync(path.join(tempRoot, 'sunat-release-secrets-'));
const cleanupRelative = path.relative(tempRoot, directory);
if (cleanupRelative.startsWith('..') || path.isAbsolute(cleanupRelative) || !/^sunat-release-secrets-[^/\\]+$/.test(cleanupRelative)) throw new Error('Carpeta temporal no válida.');

function scan(executable, args, report) {
  const run = spawnSync(executable, [...args, '--redact=100', '--no-banner', '--log-level=error', '--report-format=json', `--report-path=${report}`], {
    cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 180_000,
  });
  if (run.error) throw new Error('No se pudo completar Gitleaks; no se publicó contenido del error.');
  if (run.status === 0) return;
  if (run.status !== 1) throw new Error(`Gitleaks no terminó correctamente (código ${run.status}).`);
  const findings = JSON.parse(readFileSync(report, 'utf8'));
  for (const finding of findings) console.error(JSON.stringify({ rule: finding.RuleID, file: finding.File, line: finding.StartLine, commit: finding.Commit || undefined }));
  throw new Error(`Revisión detenida: ${findings.length} posibles secretos. No se imprimieron valores ni fragmentos.`);
}

try {
  execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectRoot, stdio: 'pipe' });
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: projectRoot, encoding: 'utf8' }).trim() === 'true') throw new Error('Se necesita el historial completo; la clonación es superficial.');
  const filename = `gitleaks_${version}_${asset[0]}`;
  const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/${filename}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`No se pudo descargar Gitleaks (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== asset[1]) throw new Error('SHA-256 de Gitleaks incorrecto; no se ejecutó el archivo.');
  const archive = path.join(directory, filename);
  writeFileSync(archive, bytes);
  const extracted = path.join(directory, 'tool');
  mkdirSync(extracted);
  if (process.platform === 'win32') {
    const escapedArchive = archive.replace(/'/g, "''");
    const escapedTarget = extracted.replace(/'/g, "''");
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedTarget}'`], { windowsHide: true, stdio: 'pipe' });
  } else execFileSync('tar', ['-xzf', archive, '-C', extracted], { stdio: 'pipe' });
  const executable = path.join(extracted, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  scan(executable, ['git', '--log-opts=--all', projectRoot], path.join(directory, 'history.json'));
  const snapshot = path.join(directory, 'files');
  mkdirSync(snapshot);
  for (const file of publicFiles()) {
    const destination = path.join(snapshot, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(projectRoot, file), destination);
  }
  scan(executable, ['dir', snapshot], path.join(directory, 'files.json'));
  console.log(`Gitleaks ${version}: historial completo y archivos candidatos revisados, sin hallazgos.`);
} finally {
  // Only the mkdtemp-created directory already verified under this process's temp root.
  rmSync(directory, { recursive: true, force: true });
}
