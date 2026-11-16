/** SUNAT Perú MCP entry point: Windows guard, server composition and stdio lifecycle. */
import 'dotenv/config';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { disconnectCdp } from './cdp-browser.js';
import { releaseBrowserLease } from './process-lease.js';
import { session } from './session-state.js';
import { createServer } from './server.js';
import { registerEstado } from './tools/estado.js';
import { registerIniciarSesion } from './tools/iniciar-sesion.js';
import { registerEjecutarLote } from './tools/ejecutar-lote.js';
import { registerGuias } from './tools/guias.js';
import { registerTrabajos } from './tools/trabajos.js';
import { registerCaptura } from './tools/captura.js';
import { registerValidarComprobante } from './tools/validar-comprobante.js';
import { registerResources } from './tools/resources.js';

if (process.platform !== 'win32') {
  throw new Error('SUNAT Perú MCP solo está disponible en Windows.');
}

const server = createServer();
registerEstado(server);
registerIniciarSesion(server);
registerEjecutarLote(server);
registerGuias(server);
registerTrabajos(server);
registerCaptura(server);
registerValidarComprobante(server);
registerResources(server);

void serveStdio(() => server);
process.stdin.once('end', () => { void disconnectCdp().finally(releaseBrowserLease).catch(() => {}); session.workStore?.close(); });
process.once('exit', () => { try { session.workStore?.close(); } catch { /* Already closed. */ } });
console.error('SUNAT Perú MCP iniciado por stdio.');
