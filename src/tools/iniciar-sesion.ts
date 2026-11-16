/** sunat_iniciar_sesion: native login with an imported account or the single saved browser credential. */

import { type McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { bindAccount } from '../account-session.js';
import { serializeBrowser } from '../browser-queue.js';
import { findSunatAccountCredential, getSunatCredentialVaultStatus } from '../credentials.js';
import { loginWithSunatAccount } from '../native-browser.js';
import { resetProcedureLearning } from '../procedure-learning.js';
import { clearAccountContext, session, verifyBinding } from '../session-state.js';

export function registerIniciarSesion(server: McpServer): void {
  server.registerTool(
    'sunat_iniciar_sesion',
    {
      description: 'Inicia sesión en SUNAT en el Brave predeterminado mediante Windows UI Automation para las credenciales, sin un navegador separado. En híbrido comprueba después el RUC autenticado mediante la conexión CDP persistente; no usa CDP para credenciales. Si hay cuentas en el almacén cifrado local, usa la única cuenta o el nombre exacto indicado; sus credenciales se escriben por teclado nativo desde stdin local, no aparecen en argumentos ni registros. Si el almacén está vacío y cuenta se omite, selecciona la única credencial guardada que Brave ofrece; nunca lee ni devuelve la contraseña. Si hay varias sugerencias, no elige ninguna. Reutiliza la sesión del mismo navegador. Para Clave SOL importada, usa npm run sunat:importar-cuentas.',
      inputSchema: z.object({
        cuenta: z.string().min(1).max(160).optional().describe('Nombre exacto de cliente tal como aparece en la planilla local. Se puede omitir cuando solo hay una cuenta importada.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ cuenta }) => serializeBrowser(async (deadlineAt) => {
      try {
        const vault = await getSunatCredentialVaultStatus();
        const account = vault.credentialCount === 0 && !cuenta ? undefined : await findSunatAccountCredential(cuenta);
        const expected = account ? bindAccount(account) : undefined;
        const reuse = expected && session.accountBinding?.id === expected.id && session.accountBinding.credentialVersion === expected.credentialVersion;
        clearAccountContext();
        const result = await loginWithSunatAccount(account, account ? Boolean(reuse) : true, deadlineAt);
        if (result.authenticated) {
          session.navigationLearningTrail = [];
          resetProcedureLearning();
          session.activeAccountKey = account?.accountKey;
          session.accountBinding = expected;
          if (expected) await verifyBinding();
          const message = result.reusedSession
            ? account ? 'Sesión SUNAT vigente de esta cuenta reutilizada en el navegador predeterminado.' : 'Sesión SUNAT ya activa en Brave; se reutilizó sin cambiar de cuenta.'
            : result.usedSavedBrowserCredential ? 'Sesión SUNAT iniciada con la credencial guardada en Brave.' : 'Sesión SUNAT iniciada con la cuenta importada en el navegador predeterminado.';
          return { content: [{ type: 'text', text: message }], structuredContent: { authenticated: true, reusedSession: result.reusedSession, accountVerified: Boolean(session.accountBinding) } };
        }
        if (account && session.activeAccountKey !== account.accountKey) session.activeAccountKey = undefined;
        const message = result.requiresUserAction ?? 'SUNAT no confirmó el inicio de sesión. Revisa el navegador predeterminado.';
        return { content: [{ type: 'text', text: message }], structuredContent: { authenticated: false, requiresUserAction: true, ...(result.code ? { code: result.code } : {}) } };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo iniciar sesión con la cuenta seleccionada.';
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    }, 30_000),
  );
}
