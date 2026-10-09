/**
 * wybix_idonut — personalización de I Do Nut ("Las donas, amordidas").
 *
 * Llena dos huecos del núcleo (src/app/marca/marca.ts):
 *   - mascota: I DO NUT ME sustituye a Wybix donde ya aparece la mascota
 *     (guía, dock, sidebar, inicio, QuickStart, venta) y acompaña el cobro
 *     en Touch;
 *   - fondoTouch: el logo, casi transparente, detrás del catálogo de Touch.
 *
 * Nada de aquí toca archivos del núcleo. Si el núcleo cambia su contrato,
 * este archivo deja de compilar y el build lo dice: no se pierde en silencio.
 */
import type { AddonWybix, MascotaDeMarca } from '../../src/app/marca/marca';

/**
 * De los cuatro estados de Wybix a los del personaje. Sin globo: al lado de la
 * mascota siempre hay texto que dice lo que pasa, y oírlo dos veces es ruido.
 */
async function cargarMascota(): Promise<MascotaDeMarca> {
  const { createMascot } = await import('./mascota/wybix-mascot.esm.js');
  return {
    nombre: 'I DO NUT ME',
    montar(host, { tam }) {
      const pequena = tam < 64;
      const m = createMascot(host, {
        reducedMotion: 'auto',
        // En el dock y la barra lateral, a 30 px, solo se mueve lo justo.
        idleMotion: pequena ? 'calm' : 'full',
        bubble: false,
        announce: false,
        // Contorno claro para que el trazo negro se lea en tema oscuro.
        halo: document.documentElement.classList.contains('dark'),
        accent: '#d0466c',
      });
      return {
        estado(e) {
          if (e === 'idle') m.clear();
          else if (e === 'atencion') void m.react('WARNING', { message: null });
          else if (e === 'exito') void m.react(pequena ? 'HAPPY' : 'SALE_SUCCESS', { message: null });
          else void m.react('ERROR', { message: null });
        },
        destruir: () => m.destroy(),
      };
    },
  };
}

const addon: AddonWybix = {
  id: 'wybix_idonut',
  nombre: 'I Do Nut',
  mascota: cargarMascota,
  mascotaEnTouch: true,
  fondoTouch: {
    claro: 'assets/addon/fondo-touch-claro.svg',
    oscuro: 'assets/addon/fondo-touch-oscuro.svg',
    tamano: '640px 420px',
  },
};

export default addon;
