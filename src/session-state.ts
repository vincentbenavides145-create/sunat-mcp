/** Shared state of the active SUNAT session: account binding, active job, pending approvals and their one-use request codec. */

import { createRequestStateCodec } from '@modelcontextprotocol/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod/v4';
import { type AccountBinding, bindAccount } from './account-session.js';
import { findSunatAccountCredential, getOperationalVault } from './credentials.js';
import { type BrowserStep, loginWithSunatAccount, resetBrowserContext, verifySunatAccount } from './native-browser.js';
import { resetProcedureLearning } from './procedure-learning.js';
import { type WorkItem, WorkStore } from './work-store.js';

export interface SessionState {
  activeAccountKey: string | undefined;
  accountBinding: AccountBinding | undefined;
  activeJobId: string | undefined;
  workStore: WorkStore | undefined;
  navigationLearningTrail: string[];
}

/** Mutable state of the single active SUNAT session. One MCP process owns one Brave session. */
export const session: SessionState = {
  activeAccountKey: undefined,
  accountBinding: undefined,
  activeJobId: undefined,
  workStore: undefined,
  navigationLearningTrail: [],
};

export interface PendingApprovalState { pendingId: string; kind?: 'reconciliation' }
export interface PendingApproval {
  click: Extract<BrowserStep, { action: 'click' }>;
  expectedUrl: string;
  expectedLabel: string;
  expectedApprovalHash: string;
  inputHash: string;
  expiresAt: number;
  learningFlowId?: string;
  jobId: string;
  accountId: string;
}
export interface PendingReconciliation { jobId: string; accountId: string; inputHash: string; pageHash: string; expiresAt: number }
export const pendingApprovals = new Map<string, PendingApproval>();
export const pendingReconciliations = new Map<string, PendingReconciliation>();
export const requestStateCodec = createRequestStateCodec<PendingApprovalState>({
  key: randomBytes(32),
  ttlSeconds: 600,
  bind: (context) => context.mcpReq.method,
});
export const approvalSchema = z.object({ approve: z.boolean() });
export async function jobs(): Promise<WorkStore> {
  if (!session.workStore) session.workStore = new WorkStore((await getOperationalVault()).key);
  return session.workStore;
}
export function clearAccountContext(): void {
  if (session.activeJobId && session.workStore) {
    const status = session.workStore.get(session.activeJobId).status;
    if (status === 'submitting') session.workStore.finishSubmission(session.activeJobId, '', undefined);
    else if (['preparing', 'awaiting_approval'].includes(status)) session.workStore.pause(session.activeJobId);
  }
  session.activeJobId = undefined;
  session.accountBinding = undefined;
  session.activeAccountKey = undefined;
  pendingApprovals.clear(); pendingReconciliations.clear();
  session.navigationLearningTrail = [];
  resetProcedureLearning(); resetBrowserContext();
}
export async function verifyBinding(): Promise<void> {
  if (!session.accountBinding) throw new Error('Selecciona una cuenta importada y verificable antes de ejecutar este trabajo.');
  try { await verifySunatAccount(session.accountBinding.ruc); }
  catch (error) { clearAccountContext(); throw error; }
}
export async function ensureAccount(cuenta?: string, job?: WorkItem, deadlineAt?: number): Promise<void> {
  let account;
  if (job) {
    const vault = await getOperationalVault();
    session.workStore?.assertKey(vault.key);
    account = vault.accounts.find((item) => item.id === job.accountId);
    if (!account) throw new Error('La cuenta de este trabajo ya no está disponible en la bóveda del operador.');
    if (cuenta && (await findSunatAccountCredential(cuenta)).id !== job.accountId) throw new Error('El trabajo pertenece a otra cuenta. No se cambió la sesión.');
  } else if (cuenta) account = await findSunatAccountCredential(cuenta);
  if (account) {
    const expected = bindAccount(account);
    if (session.accountBinding?.id !== expected.id || session.accountBinding.credentialVersion !== expected.credentialVersion) {
      clearAccountContext();
      const login = await loginWithSunatAccount(account, false, deadlineAt);
      if (!login.authenticated) throw new Error(login.requiresUserAction ?? 'SUNAT no confirmó el acceso de la cuenta solicitada.');
      session.accountBinding = expected; session.activeAccountKey = account.accountKey;
    }
  }
  if (session.accountBinding) await verifyBinding();
}
export async function checkChangedBrowserContext(result: unknown): Promise<void> {
  if (!Array.isArray(result) || !result.some((step) => step?.contextChanged === true)) return;
  pendingApprovals.clear(); pendingReconciliations.clear();
  session.navigationLearningTrail = [];
  if (session.accountBinding) await verifyBinding();
}
export function expireApprovals(): void {
  for (const [id, pending] of pendingApprovals) {
    if (pending.expiresAt < Date.now()) pendingApprovals.delete(id);
  }
  for (const [id, pending] of pendingReconciliations) if (pending.expiresAt < Date.now()) pendingReconciliations.delete(id);
}
