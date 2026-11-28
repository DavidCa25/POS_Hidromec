import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import Swal from 'sweetalert2';
import { WxSelectComponent, WxOpcion } from '../wx-select/wx-select.component';
import { AuthService } from '../../services/auth.service';
import { RegisterService } from '../../services/register.service';
import { CarneConfig, CarneService, kg, pesos } from './carne.service';

interface Linea { carne: CarneConfig; kilos: string; precio: string; }

/*
 * «LLEGÓ LA CARNE» (0095)
 *
 * La entrega del carnicero en segundos: se toca la carne, se teclean los
 * kilos y el precio por kilo ya viene escrito (el de la vez pasada). Es una
 * compra normal (`sp-register-purchase`) con la presentación «Kilo» de cada
 * carne: sube su existencia en gramos, su costo y la cuenta del proveedor.
 */
@Component({
  selector: 'app-carne-llegada',
  standalone: true,
  imports: [FormsModule, RouterLink, WxSelectComponent],
  templateUrl: './carne-llegada.component.html',
  styleUrls: ['./carne.css'],
})
export class CarneLlegadaComponent implements OnInit {
  private readonly carne = inject(CarneService);
  private readonly auth = inject(AuthService);
  private readonly register = inject(RegisterService);
  private readonly router = inject(Router);
  readonly kg = kg;
  readonly pesos = pesos;

  readonly lineas = signal<Linea[]>([]);
  readonly activa = signal(0);
  readonly proveedores = signal<WxOpcion[]>([]);
  proveedor: number | null = null;
  readonly metodo = signal<'CREDITO' | 'EFECTIVO'>('CREDITO');
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly sinCarnes = signal(false);

  readonly actual = computed(() => this.lineas()[this.activa()] ?? null);
  readonly entrega = computed(() => this.lineas()
    .map((l) => ({ l, kilos: Number(l.kilos), precio: Number(l.precio) }))
    .filter((x) => Number.isFinite(x.kilos) && x.kilos > 0));
  readonly total = computed(() => Math.round(this.entrega().reduce((s, x) => s + x.kilos * (Number.isFinite(x.precio) ? x.precio : 0), 0) * 100) / 100);
  readonly falta = computed(() => {
    if (!this.entrega().length) return 'Teclea los kilos de lo que llegó.';
    if (this.entrega().some((x) => !(x.precio > 0))) return 'Falta el precio por kilo de una carne.';
    if (!this.proveedor) return 'Elige quién la trajo.';
    return '';
  });
  readonly teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'];

  async ngOnInit() {
    try {
      const { carnes } = await this.carne.config();
      const activas = carnes.filter((c) => c.activo && c.presentacion_kilo);
      this.sinCarnes.set(!activas.length);
      this.lineas.set(activas.map((c) => ({ carne: c, kilos: '', precio: c.ultimo_precio_kg ? String(c.ultimo_precio_kg) : (c.costo_kg ? String(c.costo_kg) : '') })));
      const rs = await (window as any).electronAPI.getSuppliers();
      const lista = (Array.isArray(rs) ? rs : rs?.data ?? []) as any[];
      this.proveedores.set(lista.map((p) => ({ valor: Number(p.id), etiqueta: String(p.nombre ?? p.name ?? p.supplier_name ?? `Proveedor ${p.id}`) })));
      const ultimo = activas.find((c) => c.ultimo_proveedor)?.ultimo_proveedor ?? null;
      this.proveedor = ultimo ?? (this.proveedores().length === 1 ? Number(this.proveedores()[0].valor) : null);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudieron leer las carnes.');
    } finally { this.cargando.set(false); }
  }

  private cambiarActual(fn: (l: Linea) => Linea) {
    const i = this.activa();
    this.lineas.update((ls) => ls.map((l, k) => (k === i ? fn(l) : l)));
  }
  tecla(t: string) {
    this.cambiarActual((l) => {
      if (t === '.' && l.kilos.includes('.')) return l;
      const nuevo = (l.kilos === '0' && t !== '.' ? '' : l.kilos) + t;
      return /^\d{0,4}(\.\d{0,2})?$/.test(nuevo) ? { ...l, kilos: nuevo } : l;
    });
  }
  borrar() { this.cambiarActual((l) => ({ ...l, kilos: l.kilos.slice(0, -1) })); }
  precio(v: string) { this.cambiarActual((l) => ({ ...l, precio: v })); }
  importe(x: { kilos: number; precio: number }) { return pesos(x.kilos * (x.precio || 0), 2); }

  async guardar() {
    if (this.falta()) return;
    this.guardando.set(true); this.error.set('');
    const total = this.total();
    try {
      const r = await (window as any).electronAPI.registerPurchase({
        user_id: this.auth.usuarioActualId, supplier_id: this.proveedor,
        tax_rate: 0, tax_amount: 0, subtotal: total, total,
        payment_method: this.metodo(), register_id: this.register.registerId,
        detalles: this.entrega().map((x) => ({
          product_id: x.l.carne.carne_id, quantity: x.kilos, unit_price: x.precio, profit_percent: 0,
          presentation_id: x.l.carne.presentacion_kilo,
        })),
      });
      if (!r?.success) throw new Error(r?.error || 'No se pudo guardar la entrega.');
      const kilos = this.entrega().reduce((s, x) => s + x.kilos, 0);
      void Swal.fire({ icon: 'success', title: 'Entrega guardada', timer: 3200,
        text: `${kg(kilos)} kg por ${pesos(total, 2)}${this.metodo() === 'CREDITO' ? ', a crédito' : ', pagado de la caja'}.` });
      await this.router.navigate(['/dashboard/carne']);
    } catch (e: any) {
      this.error.set(e?.message || 'No se pudo guardar la entrega.');
    } finally { this.guardando.set(false); }
  }
}
