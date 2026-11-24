import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import Swal from 'sweetalert2';
import { GiroSaludService } from '../../core';
import { Documento, EntradaBitacora, Expediente, OrdenEstudios, SaludService, TipoDocumento, edad } from '../salud.service';
import { DOCUMENTOS, SIGNOS, definicion } from '../documentos';
import { DocumentoEditorComponent } from '../documento/documento-editor.component';
import { FichaPacienteComponent } from '../ficha/ficha-paciente.component';
import { OdontogramaComponent } from '../odontograma/odontograma.component';
import { PlanesComponent } from '../planes/planes.component';

type Pestana = 'expediente' | 'odontograma' | 'planes' | 'estudios' | 'bitacora';

const ACCIONES: Record<string, string> = {
  ALTA: 'Dio de alta al paciente', FICHA: 'Editó la ficha', VER: 'Abrió el expediente', EDITAR: 'Escribió un borrador',
  FIRMAR: 'Firmó un documento', ADENDA: 'Agregó una adenda', DESCARTAR: 'Descartó un borrador', IMPRIMIR: 'Imprimió un documento',
  EXPORTAR: 'Exportó el expediente', ODONTOGRAMA: 'Marcó el odontograma', PLAN: 'Movió un plan de tratamiento',
  ESTUDIO: 'Pidió estudios', VALIDAR: 'Validó un resultado', ENTREGAR: 'Entregó resultados',
};

/**
 * EL EXPEDIENTE DE UN PACIENTE.
 *
 * Arriba, siempre: quién es, su edad y sus ALERGIAS. Abajo, por pestañas:
 * la línea de tiempo de documentos, el odontograma y los planes (dental), y
 * la bitácora de quién lo abrió.
 *
 * Los dentales son componentes aparte y se cargan solo al abrir su pestaña:
 * un consultorio médico nunca pinta un odontograma.
 */
@Component({
  selector: 'app-salud-paciente',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DocumentoEditorComponent, FichaPacienteComponent, OdontogramaComponent, PlanesComponent],
  styleUrls: ['../../modulo-servicios/servicios.css', '../salud.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paciente.component.html',
})
export class SaludPaciente implements OnInit {
  private readonly salud = inject(SaludService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly giro = inject(GiroSaludService);

  readonly documentosDisponibles = DOCUMENTOS;
  readonly signos = SIGNOS;
  readonly id = signal(0);
  readonly exp = signal<Expediente | null>(null);
  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly pestana = signal<Pestana>('expediente');
  readonly editor = signal<{ tipo: TipoDocumento; doc: Documento | null } | null>(null);
  readonly editarFicha = signal(false);
  readonly bitacora = signal<EntradaBitacora[]>([]);
  readonly imprimiendo = signal<Documento | null>(null);
  readonly filtro = signal<TipoDocumento | 'TODOS'>('TODOS');
  readonly estudios = signal<OrdenEstudios[]>([]);

  readonly ficha = computed(() => this.exp()?.ficha ?? null);
  readonly edad = computed(() => edad(this.ficha()?.fecha_nacimiento));
  readonly iniciales = computed(() => (this.ficha()?.nombre ?? '?').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase());
  readonly documentos = computed(() => {
    const f = this.filtro();
    const docs = this.exp()?.documentos ?? [];
    return f === 'TODOS' ? docs : docs.filter((d) => d.tipo === f);
  });
  readonly sinConsentimiento = computed(() => !!this.ficha() && !this.ficha()!.consentimiento_at);

  async ngOnInit(): Promise<void> {
    this.id.set(Number(this.ruta.snapshot.paramMap.get('id')));
    await Promise.all([this.giro.cargar(), this.cargar()]);
    /* Un laboratorio o un gabinete sin consultorio no escribe notas: entra a sus estudios. */
    if (!this.giro.clinica() && this.giro.estudios()) await this.verPestana('estudios');
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    const r = await this.salud.expediente(this.id());
    this.cargando.set(false);
    if (!r.ok) { this.error.set(r.error || 'No se pudo abrir el expediente.'); return; }
    this.error.set(null);
    this.exp.set(r.datos);
    /* Un cliente sin ficha clínica entra directo a darla de alta: no hay
       nada que ver hasta tener su consentimiento. */
    if (!r.datos.ficha?.es_paciente) this.editarFicha.set(true);
  }

  async verPestana(p: Pestana): Promise<void> {
    this.pestana.set(p);
    if (p === 'estudios') {
      const r = await this.salud.ordenesEstudios({ customerId: this.id(), top: 50 });
      if (r.ok) this.estudios.set(r.datos);
    }
    if (p === 'bitacora') {
      const r = await this.salud.bitacora(this.id());
      if (r.ok) this.bitacora.set(r.datos);
    }
  }

  nuevo(tipo: TipoDocumento): void {
    if (this.sinConsentimiento()) { this.editarFicha.set(true); return; }
    this.editor.set({ tipo, doc: null });
  }

  continuar(d: Documento): void { this.editor.set({ tipo: d.tipo, doc: d }); }

  async alGuardar(e: { firmado: boolean }): Promise<void> {
    this.editor.set(null);
    await this.cargar();
    if (e.firmado) void Swal.fire({ icon: 'success', title: 'Documento firmado', timer: 1400, showConfirmButton: false });
  }

  async fichaGuardada(): Promise<void> {
    this.editarFicha.set(false);
    await this.cargar();
  }

  cerrarFicha(): void {
    this.editarFicha.set(false);
    if (!this.ficha()?.es_paciente) void this.router.navigate(['/dashboard/salud/pacientes']);
  }

  async adenda(d: Documento): Promise<void> {
    const r = await Swal.fire({
      title: 'Adenda', input: 'textarea', inputLabel: `A «${d.titulo || definicion(d.tipo).nombre}» del ${new Date(d.created_at).toLocaleDateString('es-MX')}`,
      inputPlaceholder: 'Lo que se corrige o se agrega. El documento original no cambia.',
      showCancelButton: true, confirmButtonText: 'Agregar adenda', cancelButtonText: 'Cancelar',
      inputValidator: (v) => (!v?.trim() ? 'Escribe la adenda.' : null),
    });
    if (!r.isConfirmed) return;
    const a = await this.salud.adenda(d.id, String(r.value));
    if (!a.ok) { await Swal.fire({ icon: 'error', title: 'No se pudo agregar', text: a.error }); return; }
    await this.cargar();
  }

  /** Imprime el documento firmado y lo anota en la bitácora. */
  async imprimir(d: Documento): Promise<void> {
    this.imprimiendo.set(d);
    await this.salud.bitacora(this.id(), 'IMPRIMIR', d.id);
    setTimeout(() => { window.print(); this.imprimiendo.set(null); }, 50);
  }

  nuevaOrdenEstudios(): void {
    if (this.sinConsentimiento()) { this.editarFicha.set(true); return; }
    void this.router.navigate(['/dashboard/salud/estudios'], { queryParams: { paciente: this.id() } });
  }
  abrirOrden(o: OrdenEstudios): void { void this.router.navigate(['/dashboard/salud/estudios', o.id]); }

  def = definicion;
  nombreDe(t: TipoDocumento): string { return definicion(t).nombre; }
  accion(a: string): string { return ACCIONES[a] ?? a; }
  signosDe(d: Documento): { texto: string; valor: string }[] {
    const v = d.contenido?.vitales ?? {};
    return SIGNOS.filter((s) => v[s.clave]).map((s) => ({ texto: s.texto, valor: `${v[s.clave]} ${s.unidad}` }));
  }
  /** Los campos de texto con valor, en el orden del formulario. */
  camposDe(d: Documento): { texto: string; valor: string }[] {
    return definicion(d.tipo).campos
      .filter((c) => c.tipo === 'texto' || c.tipo === 'area')
      .filter((c) => String(d.contenido?.[c.clave] ?? '').trim())
      .map((c) => ({ texto: c.texto, valor: String(d.contenido[c.clave]) }));
  }
  track = (_: number, d: Documento) => d.id;
}
