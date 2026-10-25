import os from 'node:os';
import path from 'node:path';

export function installationDirectory(): string {
  return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'SUNAT MCP');
}

/** Namespaces are not an authentication boundary: each human operator needs their own OS account. */
export function operatorDirectory(): string {
  const id = process.env.SUNAT_OPERATOR_ID ?? 'default';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) throw new Error('SUNAT_OPERATOR_ID debe ser un identificador local simple, sin rutas.');
  return id === 'default' ? installationDirectory() : path.join(installationDirectory(), 'operators', id);
}
