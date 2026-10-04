/** Un proceso y conexiones reutilizadas; las carreras conservan enParalelo. */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync, realpathSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exigirTemporal } from './temporal.mjs';
import { SERVIDOR } from './sql.mjs';
let host;
let dir;
let n = 0;
const espera = new Int32Array(new SharedArrayBuffer(4));
function iniciar() {
  if (host) return;
  dir = mkdtempSync(join(tmpdir(), 'wybix-qa-sql-'));
  host = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(dirname(fileURLToPath(import.meta.url)), 'temporal-persistente.ps1'), '-Directorio', dir], { stdio: 'ignore', windowsHide: true });
  host.unref();
  process.once('exit', () => {
    writeFileSync(join(dir, 'stop'), '');
    host.kill();
    const resuelta = realpathSync(dir);
    if (resuelta.startsWith(realpathSync(tmpdir()) + sep) && basename(resuelta).startsWith('wybix-qa-sql-')) {
      try { rmSync(resuelta, { recursive: true, force: true }); } catch { /* El SO puede terminar de cerrar el proceso después. */ }
    }
  });
}
export function consultarPersistente(db, sql) {
  exigirTemporal(db);
  iniciar();
  const id = String(++n).padStart(8, '0');
  const out = join(dir, `${id}.response.json`);
  const solicitud = join(dir, `${id}.request.json`);
  writeFileSync(solicitud + '.tmp', JSON.stringify({ server: SERVIDOR, db, sql }));
  renameSync(solicitud + '.tmp', solicitud);
  const limite = Date.now() + 620_000;
  while (!existsSync(out)) {
    if (Date.now() >= limite) throw new Error('El proceso SQL persistente no respondió; no se reintenta la escritura.');
    Atomics.wait(espera, 0, 0, 10);
  }
  const r = JSON.parse(readFileSync(out, 'utf8')); unlinkSync(out);
  return r;
}
