/** Runs Brave actions one at a time, in arrival order, with an optional overall deadline. */

import { releaseBraveUi } from './windows-ui.js';

let browserQueue: Promise<void> = Promise.resolve();

export function serializeBrowser<T>(action: (deadlineAt?: number) => Promise<T>, timeoutMs?: number): Promise<T> {
  const deadlineAt = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  let timedOut = false;
  const runWhenAvailable = async () => {
    if (timedOut || (deadlineAt !== undefined && Date.now() >= deadlineAt)) {
      throw new Error('Se agotó el límite de 30 segundos para iniciar sesión en SUNAT. El intento en cola se canceló.');
    }
    try { return await action(deadlineAt); }
    finally { await releaseBraveUi(); }
  };
  const result = browserQueue.then(runWhenAvailable, runWhenAvailable);
  browserQueue = result.then(() => undefined, () => undefined);
  if (timeoutMs === undefined) return result;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('Se agotó el límite de 30 segundos para iniciar sesión en SUNAT. El intento se canceló sin volver a conectar.'));
    }, timeoutMs);
    result.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
