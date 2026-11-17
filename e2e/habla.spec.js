/**
 * Wybix habla sin internet (Piper), en la app de verdad.
 *
 *     npx playwright test e2e/habla.spec.js
 *
 *   1. Sin la voz en la caja, la bocina de un mensaje ofrece bajarla
 *      («Bajar la voz»). Con los archivos ya en su carpeta, «Bajar la voz» no
 *      sale a internet (el canal ve que ya está) y deja la voz lista.
 *   2. Ida y vuelta: Piper dice «cuánto vendí hoy» por el canal
 *      asistente:habla y el dictado (Vosk) lo vuelve a entender. Si Vosk lo
 *      entiende, una persona también.
 *
 * Necesita la voz de Wybix y el modelo del dictado ya bajados en esta
 * máquina (carpeta de datos de Wybix, o WYBIX_HABLA / WYBIX_VOZ_MODELO). Sin
 * ellos, la prueba se salta. La descarga en sí la prueba
 * scripts/pruebas/asistente.test.mjs (hashes, cortes, restos).
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS } = require('./fixtures');

const DATOS = path.join(process.env.APPDATA || '', 'wybix-pos');
const HABLA = process.env.WYBIX_HABLA || path.join(DATOS, 'wybix-habla');
const MODELO = process.env.WYBIX_VOZ_MODELO || path.join(DATOS, 'wybix-voz', 'modelo.tar.gz');

test('Wybix: la bocina ofrece su voz y lo que dice se entiende', async ({ app }) => {
  test.skip(!fs.existsSync(path.join(HABLA, 'piper', 'piper.exe')) || !fs.existsSync(MODELO), 'Sin la voz de Wybix o sin el modelo del dictado en esta máquina');
  test.setTimeout(240000);
  const p = app.ventana;

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(CUENTAS.admin.usuario);

  await p.click('[data-guide=wybix-guide]');
  const campo = p.locator('[data-guide=wybix-campo]');
  await campo.fill('cuanto hay en caja');
  await campo.press('Enter');
  const ultimo = p.locator('[data-guide=wybix-mensaje]').last();
  await expect(ultimo).toContainText(/caja|efectivo|turno/i, { timeout: 20000 });

  // --------------------------------------- 1. sin voz, la bocina la ofrece
  const habla = p.locator('[data-guide=wybix-habla]');
  await ultimo.locator('[data-guide=wybix-leer]').click();
  await expect(habla).toHaveAttribute('data-guide-estado', 'ofrece');
  await expect(habla).toContainText('MB');
  /* La voz llega a la carpeta de datos de ESTE perfil, como en una caja. */
  fs.cpSync(HABLA, path.join(app.perfil, 'wybix-habla'), { recursive: true });
  await p.click('[data-guide=wybix-habla-descargar]');
  await expect(habla).toHaveCount(0, { timeout: 30000 });

  // --------------------------------------- 2. ida y vuelta: Piper → Vosk
  fs.mkdirSync(path.join(app.perfil, 'wybix-voz'), { recursive: true });
  fs.copyFileSync(MODELO, path.join(app.perfil, 'wybix-voz', 'modelo.tar.gz'));
  const texto = await p.evaluate(async () => {
    const h = await window.electronAPI.asistenteHabla({ texto: 'Cuánto vendí hoy.' });
    if (!h?.success || !h.data?.wav) throw new Error(h?.error || 'Piper no devolvió audio');
    const v = await window.electronAPI.asistenteVoz({ cargar: true });
    if (!v?.success || !v.data?.disponible) throw new Error('sin modelo de dictado');
    if (!window.Vosk) {
      const url = URL.createObjectURL(new Blob([v.data.motor], { type: 'text/javascript' }));
      await new Promise((ok, mal) => { const s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = mal; document.head.appendChild(s); });
    }
    const modelo = await window.Vosk.createModel(URL.createObjectURL(new Blob([v.data.modelo], { type: 'application/gzip' })));
    const ctx = new AudioContext({ sampleRate: 16000 });
    const wav = h.data.wav instanceof Uint8Array ? h.data.wav : new Uint8Array(h.data.wav);
    const audio = await ctx.decodeAudioData(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength));
    const rec = new modelo.KaldiRecognizer(audio.sampleRate);
    const partes = [];
    const listo = new Promise((ok) => rec.on('result', (m) => { if (m.result.text) partes.push(m.result.text); ok(); }));
    const datos = audio.getChannelData(0);
    const total = new Float32Array(datos.length + audio.sampleRate);
    total.set(datos);
    for (let i = 0; i < total.length; i += 4096) {
      const trozo = total.subarray(i, i + 4096);
      const b = ctx.createBuffer(1, trozo.length, audio.sampleRate);
      b.copyToChannel(trozo, 0);
      rec.acceptWaveform(b);
    }
    rec.retrieveFinalResult();
    await Promise.race([listo, new Promise((ok) => setTimeout(ok, 15000))]);
    modelo.terminate();
    return partes.join(' ');
  });
  test.info().annotations.push({ type: 'Piper dijo y Vosk entendió', description: texto });
  expect(texto).toMatch(/vend/);
  expect(texto).toMatch(/hoy/);
});
