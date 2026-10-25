import ExcelJS from 'exceljs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { saveSunatAccountCredentials, type SunatAccountCredential } from './credentials.js';

const maxWorkbookBytes = 25 * 1024 * 1024;

function cellText(cell: ExcelJS.Cell, columnName: string): string {
  const value = cell.value;
  if (value && typeof value === 'object' && 'formula' in value) {
    throw new Error(`La columna "${columnName}" contiene una fórmula; conviértela a valores antes de importar.`);
  }
  return cell.text.trim();
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('La importación de cuentas solo funciona en Windows.');
  const rl = createInterface({ input, output });
  try {
    const workbookPath = path.resolve((await rl.question('Ruta local del Excel .xlsx: ')).trim().replace(/^"|"$/g, ''));
    if (path.extname(workbookPath).toLowerCase() !== '.xlsx') throw new Error('Usa un archivo .xlsx. Guarda o exporta el Excel como .xlsx e inténtalo nuevamente.');
    const workbookStat = await stat(workbookPath);
    if (!workbookStat.isFile() || workbookStat.size < 1 || workbookStat.size > maxWorkbookBytes) throw new Error('El Excel está vacío o supera el límite local de 25 MB.');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    if (workbook.worksheets.length === 0) throw new Error('El libro no contiene hojas.');
    output.write(`Hojas disponibles: ${workbook.worksheets.map((sheet) => sheet.name).join(' | ')}\n`);
    const sheetName = (await rl.question('Nombre exacto de la hoja: ')).trim();
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) throw new Error('No existe una hoja con ese nombre.');
    const headerRowNumber = Number((await rl.question('Fila de encabezados [1]: ')).trim() || '1');
    if (!Number.isInteger(headerRowNumber) || headerRowNumber < 1 || headerRowNumber > 100) throw new Error('La fila de encabezados debe estar entre 1 y 100.');
    const headerRow = worksheet.getRow(headerRowNumber);
    const headers: Array<{ column: number; label: string }> = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, column) => {
      const label = String(cell.value ?? '').trim();
      if (label) headers.push({ column, label });
    });
    if (headers.length === 0) throw new Error('No se encontraron encabezados en esa fila.');
    output.write(`Columnas: ${headers.map(({ column, label }) => `${column}: ${label}`).join(' | ')}\n`);

    const resolveColumn = async (prompt: string, optional = false): Promise<number | undefined> => {
      const answer = (await rl.question(prompt)).trim();
      if (!answer && optional) return undefined;
      const selected = headers.find(({ label }) => label.toLocaleLowerCase('es-PE') === answer.toLocaleLowerCase('es-PE'))
        ?? headers.find(({ column }) => String(column) === answer);
      if (!selected) throw new Error(`No se encontró la columna indicada para ${prompt.split('[')[0].trim()}.`);
      return selected.column;
    };

    const accountColumn = await resolveColumn('Columna de nombre de cuenta/cliente: ');
    const documentColumn = await resolveColumn('Columna de RUC/DNI: ');
    const usernameColumn = await resolveColumn('Columna de usuario SOL (obligatoria para RUC; Enter si no aplica): ', true);
    const passwordColumn = await resolveColumn('Columna de Clave SOL: ');
    const sessionRucColumn = await resolveColumn('Columna de RUC de sesión esperado para accesos DNI (opcional; Enter si no aplica): ', true);
    const sireClientIdColumn = await resolveColumn('Columna de client_id API SIRE (opcional; Enter si no aplica): ', true);
    const sireClientSecretColumn = await resolveColumn('Columna de client_secret API SIRE (opcional; Enter si no aplica): ', true);
    if (Boolean(sireClientIdColumn) !== Boolean(sireClientSecretColumn)) {
      throw new Error('Selecciona ambas columnas API SIRE o deja ambas sin seleccionar.');
    }
    const accounts: SunatAccountCredential[] = [];
    const skippedRows: number[] = [];
    for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const accountKey = cellText(row.getCell(accountColumn!), 'cuenta');
      const document = cellText(row.getCell(documentColumn!), 'RUC/DNI').replace(/\D/g, '');
      const username = usernameColumn ? cellText(row.getCell(usernameColumn), 'usuario SOL') : '';
      const password = cellText(row.getCell(passwordColumn!), 'Clave SOL');
      const sessionRuc = sessionRucColumn ? cellText(row.getCell(sessionRucColumn), 'RUC de sesión').replace(/\D/g, '') : undefined;
      const sireClientId = sireClientIdColumn ? cellText(row.getCell(sireClientIdColumn), 'client_id API SIRE') : '';
      const sireClientSecret = sireClientSecretColumn ? cellText(row.getCell(sireClientSecretColumn), 'client_secret API SIRE') : '';
      if (!accountKey && !document && !username && !password && !sireClientId && !sireClientSecret) continue;
      if (!accountKey || !document || !password) {
        skippedRows.push(rowNumber);
        continue;
      }
      const mode = document.length === 11 ? 'ruc' : document.length === 8 ? 'dni' : undefined;
      if (!mode) {
        skippedRows.push(rowNumber);
        continue;
      }
      if (Boolean(sireClientId) !== Boolean(sireClientSecret)) {
        throw new Error(`La fila ${rowNumber} debe tener ambos valores API SIRE o dejar ambos vacíos.`);
      }
      accounts.push({
        accountKey,
        mode,
        document,
        ...(username ? { username } : {}),
        password,
        ...(sessionRuc ? { sessionRuc } : {}),
        ...(sireClientId && sireClientSecret ? { sireApi: { clientId: sireClientId, clientSecret: sireClientSecret } } : {}),
      });
    }
    if (accounts.length === 0) throw new Error('No se encontraron filas completas con cuenta, RUC/DNI y clave. No se importó ningún dato.');
    if (skippedRows.length) output.write(`Se omitirán ${skippedRows.length} filas incompletas o con documento no válido.\n`);
    const confirmation = (await rl.question(`Importar ${accounts.length} cuentas al almacén cifrado de Windows? [s/N]: `)).trim().toLowerCase();
    if (confirmation !== 's' && confirmation !== 'si' && confirmation !== 'sí') {
      output.write('Importación cancelada.\n');
      return;
    }
    const result = await saveSunatAccountCredentials(accounts);
    output.write(`Importación completada: ${result.added} nuevas, ${result.updated} actualizadas. Las claves no se mostraron.\n`);
  } finally {
    rl.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'No se pudo importar la planilla.';
  output.write(`${message}\n`);
  process.exitCode = 1;
});
