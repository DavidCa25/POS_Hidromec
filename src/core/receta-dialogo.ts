import Swal from 'sweetalert2';

/** Un producto de la venta que exige receta (lo dice el proceso principal). */
export interface ProductoConReceta {
  productId: number;
  nombre: string;
  fraccion: number | null;
  antibiotico: boolean;
  controlado: boolean;
}

/** Lo que se anota de la receta que respalda una venta de farmacia. */
export interface RecetaVenta {
  medico: string;
  cedula: string;
  /** YYYY-MM-DD */
  fecha: string;
  institucion?: string | null;
  paciente?: string | null;
  retenida: boolean;
  surtidosRestantes?: number | null;
}

const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

/**
 * LA RECETA SE PIDE EN LA CAJA, NO EN UNA PANTALLA APARTE.
 *
 * Retail y Touch cobran por `SaleService.checkout`, y es ahí donde llega la
 * respuesta RECETA_REQUERIDA del proceso principal. Este servicio solo pregunta:
 * no decide qué requiere receta (eso lo deriva SQL de la fracción y de si es
 * antibiótico) ni guarda nada (eso va con la venta, en la misma llamada).
 *
 * Antibiótico o fracción III se RETIENEN o se sellan; lo que se elige queda en
 * el libro de control.
 *
 * Se carga con import() solo cuando la caja recibe RECETA_REQUERIDA: una
 * caja que no es farmacia nunca descarga este diálogo.
 */
export async function pedirReceta(productos: ProductoConReceta[]): Promise<RecetaVenta | null> {
  const hoy = new Date();
  const iso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const fr3 = productos.some((p) => p.fraccion === 3);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const lista = productos.map((p) => {
    const tipo = p.antibiotico ? 'Antibiótico' : p.fraccion ? `Fracción ${ROMANOS[p.fraccion]}` : 'Con receta';
    return `<li><b>${esc(p.nombre)}</b> <small>${tipo}</small></li>`;
  }).join('');

  const r = await Swal.fire({
    title: 'Esta venta requiere receta',
    html: `
      <ul class="rx-lista" data-guide="receta-productos">${lista}</ul>
      <div class="rx-form">
        <label>Médico que prescribe<input id="rx-medico" class="swal2-input" autocomplete="off" data-guide="receta-medico"></label>
        <label>Cédula profesional<input id="rx-cedula" class="swal2-input" inputmode="numeric" autocomplete="off" data-guide="receta-cedula"></label>
        <label>Fecha de la receta<input id="rx-fecha" class="swal2-input" type="date" max="${iso}" value="${iso}" data-guide="receta-fecha"></label>
        <label>Institución o domicilio (opcional)<input id="rx-inst" class="swal2-input" autocomplete="off"></label>
        <label>Paciente (opcional)<input id="rx-pac" class="swal2-input" autocomplete="off"></label>
        <label class="rx-check"><input id="rx-ret" type="checkbox" data-guide="receta-retenida"> Se retiene la receta</label>
        ${fr3 ? '<label>Surtidos que quedan<input id="rx-surt" class="swal2-input" type="number" min="0" max="2" value="0"></label>' : ''}
      </div>`,
    width: 560,
    showCancelButton: true,
    confirmButtonText: 'Registrar y cobrar',
    cancelButtonText: 'Cancelar',
    focusConfirm: false,
    didOpen: () => (document.getElementById('rx-medico') as HTMLInputElement | null)?.focus(),
    preConfirm: () => {
      const v = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value?.trim() ?? '';
      const medico = v('rx-medico');
      const cedula = v('rx-cedula');
      const fecha = v('rx-fecha');
      if (!medico || !cedula || !fecha) {
        Swal.showValidationMessage('Médico, cédula y fecha son obligatorios.');
        return null;
      }
      if (!/^\d{5,10}$/.test(cedula)) {
        Swal.showValidationMessage('La cédula profesional tiene de 5 a 10 números.');
        return null;
      }
      if (fecha > iso) {
        Swal.showValidationMessage('La receta no puede tener fecha futura.');
        return null;
      }
      const surt = v('rx-surt');
      return {
        medico, cedula, fecha,
        institucion: v('rx-inst') || null,
        paciente: v('rx-pac') || null,
        retenida: !!(document.getElementById('rx-ret') as HTMLInputElement | null)?.checked,
        surtidosRestantes: surt === '' ? null : Number(surt),
      } satisfies RecetaVenta;
    },
  });
  return r.isConfirmed && r.value ? (r.value as RecetaVenta) : null;
}
