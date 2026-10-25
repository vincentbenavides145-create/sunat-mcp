import { readFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, publicFiles } from './public-files.mjs';

const prohibited = /(?:^|\/)(?:\.env(?:\..+)?|credentials|learning|screenshots|captures|node_modules|test-results|playwright-report)(?:\/|$)|\.(?:xlsx?|csv|har|db(?:-\w+)?|sqlite3?(?:-\w+)?|dpapi\.json|pem|key|pfx|p12|dmp|zip|7z)$/i;
const personalPath = /[A-Za-z]:[\\/]+Users[\\/]+(?!Public(?:[\\/]|$)|Default(?:[\\/]|$)|<|\{|YOUR_USER|USUARIO)[A-Za-z0-9_.-]+[\\/]/i;
const files = publicFiles();
const failures = [];
for (const file of files) {
  if (file !== '.env.example' && prohibited.test(file)) failures.push(`${file}: archivo local o privado no distribuible`);
  if (/\.(?:md|ts|js|mjs|json|toml|yml|yaml|ps1)$/.test(file)) {
    const source = readFileSync(path.join(projectRoot, file), 'utf8');
    if (personalPath.test(source)) failures.push(`${file}: ruta de perfil personal; usa un marcador genérico`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Distribución revisada: ${files.length} archivos candidatos, sin archivos privados ni rutas personales.`);
