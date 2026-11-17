/**
 * Dictado sin internet (Vosk) en la app de verdad.
 *
 *     npx playwright test e2e/dictado.spec.js
 *
 * El micrófono no se puede tocar en una prueba, así que se le da al
 * reconocedor un audio grabado («Cuánto vendí hoy», fixtures-archivos/) por
 * el MISMO camino que usa DictadoService: el canal asistente:voz entrega el
 * motor y el modelo, se cargan en la pantalla y se reconoce ahí.
 *
 * Antes, sin modelo: el micrófono aparece igual y, al tocarlo, ofrece bajar
 * la voz. «Bajar la voz» con el modelo ya en su carpeta no sale a internet
 * (el canal ve que ya está) y deja el micrófono listo: así se prueba el
 * camino de la pantalla sin bajar 40 MB en cada corrida. La descarga en sí
 * la prueban scripts/pruebas/asistente.test.mjs (hash, cortes, restos).
 *
 * Necesita el modelo de voz (no viaja en el repositorio, ~40 MB): se toma de
 * WYBIX_VOZ_MODELO o de la carpeta de datos de Wybix en esta máquina. Sin él,
 * la prueba se salta.
 */
const path = require('node:path');
const fs = require('node:fs');
const { test, expect, CUENTAS } = require('./fixtures');

const MODELO = process.env.WYBIX_VOZ_MODELO
  || path.join(process.env.APPDATA || '', 'wybix-pos', 'wybix-voz', 'modelo.tar.gz');
const AUDIO = path.join(__dirname, 'fixtures-archivos', 'dictado-cuanto-vendi-hoy.wav');

test('Wybix: el micrófono ofrece bajar la voz y el dictado reconoce español sin internet', async ({ app }) => {
  test.skip(!fs.existsSync(MODELO), `Sin modelo de voz en ${MODELO}`);
  test.setTimeout(240000);
  const p = app.ventana;

  await p.fill('#username', CUENTAS.admin.usuario);
  await p.fill('#password', CUENTAS.admin.password);
  await p.click('#btnLogin');
  await expect.poll(async () => { try { return (await app.invocar('sesion'))?.data?.usuario; } catch { return null; } }, { timeout: 60000 })
    .toBe(CUENTAS.admin.usuario);

  await p.click('[data-guide=wybix-guide]');
  const mic = p.locator('[data-guide=wybix-microfono]');
  await expect(mic).toBeVisible({ timeout: 20000 });

  /* Sin modelo: el micrófono ofrece bajar la voz; «Ahora no» lo cierra. */
  const voz = p.locator('[data-guide=wybix-voz]');
  await mic.click();
  await expect(voz).toHaveAttribute('data-guide-estado', 'ofrece');
  await expect(voz).toContainText('40 MB');
  await p.click('[data-guide=wybix-voz-cerrar]');
  await expect(voz).toHaveCount(0);

  /* El modelo llega a la carpeta de datos de ESTE perfil, como en una caja;
     «Bajar la voz» lo encuentra y deja el micrófono listo. */
  fs.mkdirSync(path.join(app.perfil, 'wybix-voz'), { recursive: true });
  fs.copyFileSync(MODELO, path.join(app.perfil, 'wybix-voz', 'modelo.tar.gz'));
  await mic.click();
  await p.click('[data-guide=wybix-voz-descargar]');
  await expect(voz).toHaveCount(0, { timeout: 20000 });

  const texto = await p.evaluate(async (wavBase64) => {
    const r = await window.electronAPI.asistenteVoz({ cargar: true });
    if (!r?.success || !r.data?.disponible) throw new Error('asistente:voz no entregó el modelo');
    if (!window.Vosk) {
      const url = URL.createObjectURL(new Blob([r.data.motor], { type: 'text/javascript' }));
      await new Promise((ok, mal) => { const s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = mal; document.head.appendChild(s); });
    }
    const modelo = await window.Vosk.createModel(URL.createObjectURL(new Blob([r.data.modelo], { type: 'application/gzip' })));
    const bytes = Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0));
    const ctx = new AudioContext({ sampleRate: 16000 });
    const audio = await ctx.decodeAudioData(bytes.buffer);
    const rec = new modelo.KaldiRecognizer(audio.sampleRate);
    const partes = [];
    const listo = new Promise((ok) => rec.on('result', (m) => { if (m.result.text) partes.push(m.result.text); ok(); }));
    /* Pedazos de 4096 muestras, como el ScriptProcessor de la pantalla, y un segundo de silencio al final. */
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
  }, fs.readFileSync(AUDIO).toString('base64'));

  test.info().annotations.push({ type: 'reconocido', description: texto });
  expect(texto).toMatch(/vend/);
  expect(texto).toMatch(/hoy/);
});
