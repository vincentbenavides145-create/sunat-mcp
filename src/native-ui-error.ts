/** The error every native and CDP browser operation throws. Lives alone so any layer can import it without a cycle. */

import type { CdpDiagnostic } from './cdp-diagnostics.js';

export class NativeUiError extends Error {
  actionDispatched?: boolean;
  /** Sanitised classification of a CDP failure; never the original exception or page data. */
  diagnostic?: CdpDiagnostic;
  constructor(public readonly code: string, message = 'Windows no pudo completar la acción en Brave.') { super(message); }
}
