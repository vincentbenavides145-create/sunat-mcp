import { fileURLToPath } from 'node:url';

// Codex can launch stdio servers from any working directory.
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
await import('../src/index.ts');
