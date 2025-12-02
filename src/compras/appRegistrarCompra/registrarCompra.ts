import { Component, HostListener, LOCALE_ID, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe } from '@angular/common';
import { registerLocaleData } from '@angular/common';
import localeEsMX from '@angular/common/locales/es-MX';
import { AuthService } from '../../services/auth.service';
import Swal from 'sweetalert2';

registerLocaleData(localeEsMX, 'es-MX');

interface ProductRow {
  id: number;
  part_number: string;
  product_name: string;
  price: number;
  stock: number;
  category_name: string;
  brand_name: string;
  purchasePrice?: number;
}
interface Proveedor { id: number; nombre: string; }

class PurchaseItem {
  constructor(
    public productId: number,
    public productName: string,
    public qty: number,
    public unitPrice: number,
    public purchasePrice: number,
    public proveedorId: number | null
  ) {}
  get subtotal(){ return this.qty * this.purchasePrice; }
}

@Component({
  selector: 'app-registrar-compra',
  standalone: true,
  templateUrl: './registrarCompra.html',
  styleUrls: ['./registrarCompra.css'],
  imports: [RouterOutlet, FormsModule, NgIf, NgFor, CurrencyPipe, DatePipe, SlicePipe],
  providers: [{ provide: LOCALE_ID, useValue: 'es-MX' }]
})
export class RegistrarCompra implements OnInit {
  folio: number | null = null;
  today = new Date();

  proveedores: Proveedor[] = [];
  proveedorSeleccionado: number | null = null;

  showModalProductos = false;
  productos: ProductRow[] = [];
  filtro = '';

  items: PurchaseItem[] = [];
  ivaTasa = 0.16;

  constructor(private authService: AuthService){
    this.cargarProveedores();
  }
  ngOnInit(){ this.cargarFolio(); }

  cargarFolio(){
    (window as any).electronAPI.getNextPurchaseFolio()
      .then((r:any)=>{ if(r?.success) this.folio = r.folio; })
      .catch((e:any)=> console.error('Folio:', e));
  }
  get usuarioActualId(){ return this.authService.usuarioActualId ?? 0; }

  get subtotal(){ return this.items.reduce((a,it)=>a+it.subtotal,0); }
  get iva(){ return this.subtotal * this.ivaTasa; }
  get total(){ return this.subtotal + this.iva; }

  async cargarProveedores(){
    try{
      const rs = await (window as any).electronAPI.getSuppliers();
      this.proveedores = Array.isArray(rs) ? rs : [];
    }catch(e){ console.error(e); this.proveedores = []; }
  }

  async abrirModalProductos(){
    this.filtro = '';
    await this.cargarProductosActivos();
    this.showModalProductos = true;
  }
  cerrarModalProductos(){ this.showModalProductos = false; }

  async cargarProductosActivos(){
    try{
      const rs = await (window as any).electronAPI.getActiveProducts();
      const rows = Array.isArray(rs?.recordset) ? rs.recordset : Array.isArray(rs) ? rs : [];
      this.productos = rows.map((r:any)=>({
        id:r.id, part_number:r.part_number, product_name:r.product_name, price:r.price, stock:r.stock,
        category_name:r.category_name, brand_name:r.brand_name, purchasePrice:0
      }));
    }catch(e){ console.error(e); this.productos = []; }
  }

  seleccionarProducto(p: ProductRow & { purchasePrice?: number }){
    const existing = this.items.find(it=>it.productId===p.id);
    if(existing){ existing.qty += 1; this.showModalProductos=false; return; }
    this.items.push(new PurchaseItem(p.id, p.product_name, 1, p.price ?? 0, p.purchasePrice ?? 0, null));
    this.showModalProductos=false;
  }

  onQtyChange(i:number){ const it=this.items[i]; if(!it) return; if(it.qty<1) it.qty=1; }
  onPurchasePriceChange(i:number){ const it=this.items[i]; if(!it) return; if(it.purchasePrice<0) it.purchasePrice=0; }
  onProveedorChange(i:number, val?:number|null){ const it=this.items[i]; if(!it) return; it.proveedorId = val==null? null : Number(val); }
  quitarItem(i:number){ this.items.splice(i,1); }
  trackByItem = (_:number, it:PurchaseItem)=> it.productId;

  registrarCompra(){
    if(this.items.length===0){
      Swal.fire({icon:'error',title:'Oops...',text:'No hay productos en la compra'}); return;
    }
    if(this.items.some(it=>!it.proveedorId)){
      Swal.fire({icon:'error',title:'Oops...',text:'Todos los productos deben tener un proveedor seleccionado'}); return;
    }
    const payload = {
      user_id: this.usuarioActualId, tax_rate: this.ivaTasa, tax_amount: this.iva,
      subtotal: this.subtotal, total: this.total,
      detalles: this.items.map(it=>({
        product_id: it.productId, supplier_id: it.proveedorId, quantity: it.qty, unit_price: it.purchasePrice
      }))
    };

    (window as any).electronAPI.registerPurchase(payload)
      .then((res:any)=>{
        if(res?.success){
          Swal.fire({icon:'success',title:'Compra registrada',text:`Folio: ${res.folio}`});
          this.items = [];
          this.cargarFolio();
        }else{
          Swal.fire({icon:'error',title:'Error al registrar compra',text: res?.message || 'Ocurrió un error.'});
        }
      })
      .catch((err:any)=>{
        console.error(err);
        Swal.fire({icon:'error',title:'Error al registrar compra',text:'Ocurrió un error inesperado.'});
      });
  }

  @HostListener('window:keydown',['$event'])
  handleKeyboardEvent(e:KeyboardEvent){
    if(e.key==='F8'){ e.preventDefault(); this.registrarCompra(); }
  }
}
