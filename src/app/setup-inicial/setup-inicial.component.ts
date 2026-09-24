import { Component, EventEmitter, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Swal from 'sweetalert2';
import { LicenseService } from '../../services/license.service';
import { CATALOGOS_GIRO, GiroCatalogo } from './catalogos-giro';
import { BusinessProfile, CapabilityService, DeviceProfile } from '../../core';
import { PRESETS_SERVICIOS, PresetServicios } from '../../core/presets-servicios';

@Component({
  selector: 'app-setup-inicial',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './setup-inicial.component.html',
  styleUrls: ['./setup-inicial.component.css']
})
export class SetupInicial implements OnInit {
  @Output() completado = new EventEmitter<void>();

  // 1 = licencia, 2 = negocio, 3 = administrador
  paso = 2;
  procesando = false;

  // Paso 1: licencia
  clave = '';
  aliasCaja = '';

  // Paso 2: negocio
  businessName = '';
  address = '';
  phone = '';
  rfc = '';

  /**
   * Que vende el negocio. Va a business_config y decide si existen recetas,
   * ingredientes y modificadores. Se pregunta en la primera pantalla para que
   * nadie tenga que descubrir despues donde se activa Hospitality.
   */
  businessProfile: BusinessProfile = 'RETAIL';

  /**
   * SERVICIOS NO ES UN `business_profile`.
   *
   * La columna solo admite RETAIL y HOSPITALITY -hay un CHECK en la base- y
   * eso esta bien: lo que decide son las recetas y los ingredientes. Un taller
   * o una barberia SON comercio que ademas cobra por trabajo, asi que eligen
   * RETAIL y ENCIENDEN EL MODULO. El giro se guarda aparte, en
   * `services_config`, que es donde vive desde que existe el modulo.
   *
   * Por eso este selector no es `BusinessProfile` a secas: es lo que el
   * usuario reconoce -tres clases de negocio- traducido a las dos cosas que el
   * sistema guarda por separado.
   */
  tipoNegocio: 'RETAIL' | 'HOSPITALITY' | 'SERVICIOS' = 'RETAIL';

  readonly tiposNegocio: { valor: 'RETAIL' | 'HOSPITALITY' | 'SERVICIOS'; titulo: string; icono: string; ejemplos: string }[] = [
    { valor: 'RETAIL', titulo: 'Tienda o comercio', icono: 'ph-storefront',
      ejemplos: 'Abarrotes · Ferreterías · Refaccionarias · Papelerías' },
    { valor: 'HOSPITALITY', titulo: 'Alimentos y bebidas', icono: 'ph-coffee',
      ejemplos: 'Cafeterías · Panaderías · Heladerías · Comida rápida' },
    { valor: 'SERVICIOS', titulo: 'Servicios', icono: 'ph-wrench',
      ejemplos: 'Talleres · Barberías · Reparación · Mantenimiento' },
  ];

  /**
   * El giro, cuando el negocio es de servicios.
   *
   * Sale del MISMO archivo que lee el proceso principal y el gestor de demos
   * (`electron/servicios/presets.json`). No hay una lista de giros para el
   * asistente y otra para produccion: eso fue una decision explicita cuando se
   * construyo el modulo y no se rompe aqui.
   */
  readonly presets: PresetServicios[] = PRESETS_SERVICIOS;
  presetGiro = '';

  /**
   * Como se usara ESTA computadora. Vive en device-config.json, no en la
   * base: dos cajas de la misma sucursal pueden ser una Retail y otra Touch.
   * Se cambia despues en Configuracion sin reinstalar nada.
   */
  deviceProfile: DeviceProfile = 'RETAIL_POS';

  readonly usosDispositivo: { valor: DeviceProfile; titulo: string; icono: string; desc: string }[] = [
    { valor: 'RETAIL_POS', titulo: 'Punto de venta', icono: 'ph-barcode',
      desc: 'Teclado, lector de códigos y folio. La pantalla de venta clásica.' },
    { valor: 'TOUCH_POS', titulo: 'Punto de venta táctil', icono: 'ph-hand-tap',
      desc: 'Pantalla táctil con categorías, fotos y modificadores. Para mostrador.' },
    { valor: 'BACKOFFICE', titulo: 'Solo administración', icono: 'ph-desktop',
      desc: 'Esta computadora no cobra: inventario, compras y reportes.' },
  ];

  // Paso 3: administrador
  usuario = '';
  password = '';
  passwordConfirm = '';
  verPassword = false;

  // ---------- Paso 4: datos iniciales (onboarding) ----------
  obVista: 'pregunta' | 'importar' | 'giro' = 'pregunta';
  giros: GiroCatalogo[] = CATALOGOS_GIRO;
  giroCargando: string | null = null;

  constructor(private license: LicenseService, private caps: CapabilityService) {}

  elegirTipoNegocio(v: 'RETAIL' | 'HOSPITALITY' | 'SERVICIOS') {
    this.tipoNegocio = v;
    /* Servicios guarda RETAIL: lo que cambia no es que vende, es que ademas
       cobra trabajo, y eso es un modulo. */
    this.businessProfile = v === 'HOSPITALITY' ? 'HOSPITALITY' : 'RETAIL';
    if (v !== 'SERVICIOS') this.presetGiro = '';
    // Sugerencia, no imposicion: el usuario puede cambiarla en el paso
    // siguiente y despues en Configuracion.
    this.deviceProfile = v === 'HOSPITALITY' ? 'TOUCH_POS' : 'RETAIL_POS';
  }

  get esServicios(): boolean { return this.tipoNegocio === 'SERVICIOS'; }

  elegirGiroNegocio(id: string) { this.presetGiro = id; }

  // ---------- El logo del negocio ----------
  /**
   * LA IMAGEN SE ENCOGE AQUI, EN LA PANTALLA.
   *
   * El mismo archivo encabeza el ticket termico (384-576 px de ancho), los PDF
   * y la pantalla del cliente. Guardar el original de 4000 px hace lento cada
   * ticket; guardarlo a 384 se ve bien en papel y pixelado en todo lo demas.
   * 1024 px por el lado mayor cubre los tres usos.
   *
   * Se hace con `canvas` porque el navegador ya sabe redimensionar: meter una
   * libreria de imagen en el proceso principal seria pagar megabytes por esto.
   * Y NO se amplia nunca: un logo de 200 px estirado a 1024 se ve peor, no
   * mejor.
   */
  readonly LOGO_LADO_MAX = 1024;
  /** Lo que se acepta del disco antes de tocarlo. */
  readonly LOGO_ARCHIVO_MAX = 8 * 1024 * 1024;

  logoPreview: string | null = null;
  logoGuardando = false;

  async alElegirLogo(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';               // permite volver a elegir el mismo archivo
    if (!file) return;

    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      await Swal.fire({ icon: 'warning', title: 'Formato no admitido',
                        text: 'Usa una imagen PNG, JPG o WebP.' });
      return;
    }
    if (file.size > this.LOGO_ARCHIVO_MAX) {
      await Swal.fire({ icon: 'warning', title: 'Imagen muy pesada',
                        text: 'El archivo no debe pasar de 8 MB.' });
      return;
    }

    this.logoGuardando = true;
    try {
      const png = await this.aPngAcotado(file);
      const r = await this.api?.ticketGuardarLogo?.({ base64: png });
      if (!r?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo guardar',
                          text: r?.error || 'Intenta con otra imagen.' });
        return;
      }
      this.logoPreview = png;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo leer la imagen',
                        text: e?.message || 'Intenta con otra.' });
    } finally {
      this.logoGuardando = false;
    }
  }

  async quitarLogo() {
    this.logoGuardando = true;
    try {
      await this.api?.ticketBorrarLogo?.();
      this.logoPreview = null;
    } finally { this.logoGuardando = false; }
  }

  /** Lee el archivo, lo encoge si hace falta y lo devuelve como PNG. */
  private aPngAcotado(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const lado = Math.max(img.naturalWidth, img.naturalHeight);
          /* Nunca por encima de 1: no se amplia. */
          const escala = Math.min(1, this.LOGO_LADO_MAX / (lado || 1));
          const w = Math.max(1, Math.round(img.naturalWidth * escala));
          const h = Math.max(1, Math.round(img.naturalHeight * escala));

          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          if (!ctx) throw new Error('No se pudo preparar la imagen.');
          /* Suavizado alto: encoger sin el deja bordes dentados, que es
             justamente lo que se ve feo en un ticket impreso. */
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);

          /* PNG y no JPG: un logo suele tener fondo transparente, y un JPG lo
             rellena de blanco sobre el papel del ticket. */
          resolve(c.toDataURL('image/png'));
        } catch (e) { reject(e); }
        finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('La imagen no se pudo abrir.')); };
      img.src = url;
    });
  }

  get esRecomendado(): (v: DeviceProfile) => boolean {
    const sugerido: DeviceProfile = this.businessProfile === 'HOSPITALITY' ? 'TOUCH_POS' : 'RETAIL_POS';
    return (v: DeviceProfile) => v === sugerido;
  }

  private get api() { return (window as any).electronAPI; }

  async ngOnInit() {
    // Si ya hay licencia activa, salta al paso 2
    const ok = await this.license.iniciar();
    if (ok) this.paso = 2;
  }

  /**
   * Insignia del paso 2.
   *
   * Decia siempre "Licencia MonoCaja activada", con sello de verificacion,
   * tambien en una instalacion de prueba. Dos motivos, y los dos importan:
   * leia `esMulticaja` -un getter binario, sin idea de que existe la prueba- y
   * ademas lo derivaba de `licencia`, el objeto heredado, en vez de `estado`,
   * que es lo que calcula Electron y lo que usa el resto de la aplicacion.
   *
   * El icono cambia con el texto: un sello de verificacion sobre una prueba es
   * la misma afirmacion falsa, dibujada.
   */
  get insignia(): { icono: string; texto: string; prueba: boolean } {
    /*
     * CUATRO CLASES, SIN MEZCLARLAS.
     *
     * Decia siempre "Licencia MonoCaja activada", tambien en una instalacion
     * de prueba, porque leia un getter binario que no sabia que la prueba
     * existe. Despues dijo "Prueba gratis de MonoCaja activada", que arreglaba
     * la mitad: seguia metiendo el nombre de un plan comercial en algo que
     * nadie ha comprado.
     *
     * La prueba tiene identidad PROPIA. Que por dentro conceda los mismos
     * limites que MonoCaja es una decision de la logica, no algo que deba
     * aparecer en la insignia.
     *
     * El icono cambia con el texto: un sello de verificacion sobre una prueba
     * es la misma afirmacion falsa, dibujada.
     */
    const clase = this.license.clase;
    const texto = this.license.insigniaTexto;
    if (clase === 'demo')  return { icono: 'ph ph-flask', prueba: true, texto };
    if (clase === 'trial') return { icono: 'ph ph-hourglass', prueba: true, texto };
    if (clase === 'mono' || clase === 'multi') {
      return { icono: 'ph-fill ph-seal-check', prueba: false, texto };
    }
    return { icono: 'ph ph-warning', prueba: true, texto };
  }

  // Formatea la clave mientras escribe
  onClaveInput(v: string) {
    const limpio = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const partes: string[] = [];
    if (limpio.length > 0) partes.push(limpio.slice(0, 4));
    if (limpio.length > 4) partes.push(limpio.slice(4, 6));
    if (limpio.length > 6) partes.push(limpio.slice(6, 10));
    if (limpio.length > 10) partes.push(limpio.slice(10, 14));
    this.clave = partes.join('-');
  }

  // ---------- Paso 2 ----------
  siguienteNegocio() {
    if (!this.businessName.trim()) {
      Swal.fire({ icon: 'warning', title: 'Falta el nombre', text: 'Escribe el nombre de tu negocio.' });
      return;
    }
    /* Un negocio de servicios SIN giro no se puede configurar: el giro decide
       el vocabulario, la pantalla de entrada y si hay agenda o activos. Dejarlo
       vacio serviria un modulo generico que no se parece a lo que hace nadie. */
    if (this.esServicios && !this.presetGiro) {
      Swal.fire({ icon: 'warning', title: 'Falta el giro',
                  text: 'Elige a qué se dedica principalmente tu negocio.' });
      return;
    }
    this.paso = 3;
  }

  // ---------- Paso 3 ----------
  get passwordValida(): boolean {
    return this.password.length >= 6;
  }
  get passwordsCoinciden(): boolean {
    return this.password.length > 0 && this.password === this.passwordConfirm;
  }

  async finalizar() {
    if (this.usuario.trim().length < 3) {
      await Swal.fire({ icon: 'warning', title: 'Usuario invalido', text: 'Debe tener al menos 3 caracteres.' });
      return;
    }
    if (!this.passwordValida) {
      await Swal.fire({ icon: 'warning', title: 'Contrasena corta', text: 'Debe tener al menos 6 caracteres.' });
      return;
    }
    if (!this.passwordsCoinciden) {
      await Swal.fire({ icon: 'warning', title: 'No coinciden', text: 'Las contrasenas no son iguales.' });
      return;
    }

    this.procesando = true;
    try {
      const res = await this.api?.setupInicial?.({
        usuario: this.usuario.trim(),
        password: this.password,
        business_name: this.businessName.trim(),
        address: this.address.trim() || null,
        phone: this.phone.trim() || null,
        rfc: this.rfc.trim().toUpperCase() || null,
        // Lo elegido en el paso 2. Decide si el negocio tiene recetas,
        // ingredientes y modificadores: no es una preferencia visual.
        business_profile: this.businessProfile
      });

      if (!res?.success) {
        await Swal.fire({ icon: 'error', title: 'No se pudo configurar', text: res?.error || 'Error al crear el usuario.' });
        return;
      }

      /*
       * EL GIRO, DESPUES DEL ALTA.
       *
       * `servicios:elegir-giro` guarda el preset Y enciende el modulo en la
       * misma transaccion. Va aqui y no en el paso 2 porque encender un modulo
       * antes de que exista el negocio lo dejaria colgando de nada: si el alta
       * fallara, quedaria un modulo activo en una base sin configurar.
       */
      if (this.esServicios && this.presetGiro) {
        const g = await this.api?.serviciosElegirGiro?.(this.presetGiro);
        if (!g?.success) {
          await Swal.fire({
            icon: 'warning', title: 'El negocio quedo creado',
            text: 'No se pudo activar Servicios. Puedes encenderlo en Aplicaciones.',
          });
        }
      }

      /* El nombre definitivo ya existe: se manda a la nube. No se espera ni se
         comprueba -es best effort- porque nada de lo que sigue depende de el. */
      void this.api?.licenseSyncTrialName?.({ businessName: this.businessName.trim() });

      // El giro que se acaba de guardar decide si el negocio tiene recetas,
      // ingredientes y modificadores. Las capacidades en memoria se cargaron
      // ANTES de existir la configuracion, asi que aqui quedan obsoletas: se
      // releen ahora, no en el proximo arranque.
      await this.caps.load(true);

      await Swal.fire({
        icon: 'success',
        title: 'Cuenta creada',
        html: `<b>${this.businessName}</b> esta configurado.`,
        timer: 1200,
        showConfirmButton: false
      });
      this.paso = 4;
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'Error inesperado.' });
    } finally {
      this.procesando = false;
    }
  }

  // ---------- Paso 4: onboarding ----------
  elegirImportar() { this.obVista = 'importar'; }
  /** Guarda como se usara esta computadora y sigue al ultimo paso. */
  async confirmarDispositivo() {
    this.procesando = true;
    try {
      // Por el servicio, no por la API directa: asi el perfil queda guardado
      // Y ademas actualizado en memoria. Escribir el JSON a mano dejaba a la
      // aplicacion creyendo que la caja seguia siendo la de antes.
      await this.caps.setDeviceProfile(this.deviceProfile);
    } catch { /* se puede ajustar despues en Configuracion */ }
    finally {
      this.procesando = false;
      this.paso = 4;
    }
  }

  elegirGiro() { this.obVista = 'giro'; }
  volverPregunta() { this.obVista = 'pregunta'; }

  async cargarGiro(g: GiroCatalogo) {
    const conf = await Swal.fire({
      icon: 'question',
      title: `Cargar catalogo de ${g.nombre}`,
      html: `Se agregaran <b>${g.productos.length}</b> productos base (sin precio). Podras editarlos despues.`,
      showCancelButton: true,
      confirmButtonText: 'Cargar',
      cancelButtonText: 'Cancelar'
    });
    if (!conf.isConfirmed) return;

    this.giroCargando = g.id;
    try {
      const rows = g.productos.map(pr => ({
        part_number: pr.part_number,
        name: pr.name,
        brand_name: pr.brand_name ?? null,
        category_name: pr.category_name,
        price: null, stock: null,
        bar_code: null, clave_prod_serv: null, clave_unidad: null,
        objeto_impuesto: null, tasa_iva: null
      }));
      const res = await this.api?.importProducts?.({ rows });
      if (!res?.success) throw new Error(res?.error || 'No se pudo cargar el catalogo.');
      const d = res.data || {};
      await Swal.fire({
        icon: 'success',
        title: 'Catalogo cargado',
        html: `Productos agregados: <b>${d.inserted ?? 0}</b><br>Categorias creadas: <b>${d.categories_created ?? 0}</b>`
      });
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'Error', text: e?.message || 'No se pudo cargar.' });
    } finally {
      this.giroCargando = null;
    }
  }

  terminar() {
    this.completado.emit();
  }
}