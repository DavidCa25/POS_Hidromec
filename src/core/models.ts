/*
 * Wybix Core — modelo compartido por Retail POS, Touch POS y Backoffice.
 *
 * Todo lo que aqui se define es independiente de la pantalla que lo use. Las
 * pantallas son capas de presentacion: no calculan totales, no arman la venta
 * y no hablan con el inventario.
 */

/** Como se descuenta inventario al vender. Ver ADR de dominio (Gate 3). */
export type InventoryMode = 'DIRECT' | 'RECIPE' | 'NONE';

/** Metodos de pago que entiende sp_register_sale hoy. */
export type PaymentMethod = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'CREDITO' | 'TERMINAL_MP';

/** Atributo de la VENTA, no del producto. V1 no altera impuestos. */
export type ServiceMode = 'DINE_IN' | 'TAKEAWAY';

/** Producto tal como lo entrega el catalogo (sp_get_active_products). */
export interface CatalogProduct {
  id: number;
  part_number: string;
  bar_code: string;
  product_name: string;
  price: number;
  stock: number;
  category_id?: number | null;
  category_name: string;
  brand_name: string;
  clave_prod_serv?: string | null;
  clave_unidad?: string | null;
  objeto_impuesto?: string | null;
  tasa_iva?: number | null;
  inventory_mode?: InventoryMode;
  sellable?: boolean;
  /**
   * Unidades que hay DE VERDAD. Para DIRECT es su stock; para RECIPE, las que
   * alcanzan sus ingredientes. `products.stock` de una receta es 0 por diseno
   * y pintarlo como disponibilidad era enganoso.
   */
  available_units?: number;
  base_uom?: string;
  /** Que ingrediente limita una receta, y cuanto pide por unidad. */
  limita_nombre?: string | null;
  limita_stock?: number | null;
  limita_uom?: string | null;
  limita_necesita?: number | null;
  allow_decimal_qty?: boolean;
  has_modifiers?: boolean;
  thumb?: string | null;
}

/**
 * Opcion elegida sobre una linea (tamano, extra, sustitucion, nota).
 * En Retail siempre va vacio. La APP solo declara QUE se eligio; SQL decide
 * que inventario se descuenta.
 */
export interface SelectedOption {
  groupId: number;
  optionId: number;
  groupName: string;
  optionName: string;
  priceDelta: number;
  quantity: number;
}

/** Cliente asignado al carrito (contado). Es el objeto que ya usaba Retail. */
export interface CartCustomer {
  id: number;
  name: string;
  tax_id?: string | null;
  razon_social?: string | null;
  regimen_fiscal?: string | null;
  uso_cfdi?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Datos que el carrito necesita para armar una linea. Es un subconjunto de
 * CatalogProduct para que una venta cargada por folio (sin catalogo) tambien
 * pueda construir lineas.
 */
export interface LineSource {
  productId: number;
  productName: string;
  unitPrice: number;
  claveProdServ?: string | null;
  claveUnidad?: string | null;
  objetoImpuesto?: string | null;
  tasaIva?: number | null;
  inventoryMode?: InventoryMode;
}

/** Cabecera de una venta cargada por folio. */
export interface SaleHeader {
  sale_id: number;
  datee: string | Date;
  user_id: number;
  total: number;
  payment_method: string;
  customer_id: number | null;
  paid_amount: number;
  balance: number;
  due_date: string | null;
  refund_total: number;
}

export interface SaleDetailRow {
  sale_id: number;
  product_id: number;
  product_name?: string;
  productName?: string;
  name?: string;
  nombre?: string;
  quantity: number;
  unitary_price: number;
  refunded_qty?: number;
  remaining_qty?: number;
  clave_prod_serv?: string | null;
  clave_unidad?: string | null;
  objeto_impuesto?: string | null;
  tasa_iva?: number | null;
}

/** Lo que la APP declara al cobrar. */
export interface Payment {
  method: PaymentMethod;
  /** Dinero recibido (contado). null en credito/terminal. */
  received?: number | null;
  /** Cliente de credito (obligatorio en CREDITO). */
  creditCustomerId?: number | null;
  dueDate?: string | null;
}

/**
 * CONTRATO DE VENTA (frontend -> IPC). Version 1: identico a lo que
 * sp_register_sale recibe hoy. `options` viaja ya en el contrato para que
 * Touch no necesite un segundo camino cuando exista SaleDetailType2.
 */
export interface SaleIntentLine {
  productId: number;
  qty: number;
  unitPrice: number;
  options: SelectedOption[];
  note?: string | null;
}

export interface SaleIntent {
  userId: number;
  paymentMethod: PaymentMethod;
  lines: SaleIntentLine[];
  customerId: number | null;
  dueDate: string | null;
  registerId: number | null;
  serviceMode: ServiceMode | null;
}

export interface CheckoutResult {
  ok: boolean;
  error?: string;
  saleId?: number | null;
  total?: number;
  paid?: number;
  change?: number;
  isCredit?: boolean;
  /** Copia de las lineas vendidas (para facturar despues de limpiar). */
  lines?: SoldLine[];
  customer?: CartCustomer | null;
}

export interface SoldLine {
  productId: number;
  productName: string;
  qty: number;
  unitPrice: number;
  claveProdServ: string | null;
  claveUnidad: string | null;
  objetoImpuesto: string | null;
  tasaIva: number | null;
  options: SelectedOption[];
}

/** Estado del turno de la caja actual. */
export interface ShiftState {
  open: boolean;
  id: number | null;
  openedAt: Date | null;
  openingCash: number;
}

/** Perfil del NEGOCIO: vive en SQL (business_config). */
export type BusinessProfile = 'RETAIL' | 'HOSPITALITY';

/** Perfil del DISPOSITIVO: vive en device-config.json de cada caja. */
export type DeviceProfile = 'BACKOFFICE' | 'RETAIL_POS' | 'TOUCH_POS';

export interface Capabilities {
  businessProfile: BusinessProfile;
  deviceProfile: DeviceProfile;
  /** Recetas, modificadores, ingredientes, presentaciones. */
  hospitality: boolean;
  /** Esta caja abre la experiencia Touch. */
  touchPos: boolean;
  /** Esta caja abre la experiencia Retail. */
  retailPos: boolean;
  /** Pantalla de cliente habilitada en ESTE dispositivo. */
  customerDisplay: boolean;
}

/** Estado que se empuja a la pantalla de cliente (push unidireccional). */
export type CustomerDisplayState =
  | { mode: 'idle' }
  | {
      mode: 'sale';
      items: { name: string; qty: number; unitPrice: number; importe: number; options?: string }[];
      subtotal: number;
      tax: number;
      discount: number;
      total: number;
      serviceMode?: ServiceMode | null;
    }
  | {
      mode: 'checkout';
      total: number;
      paid: number | null;
      change: number | null;
      method: PaymentMethod;
      credito: boolean;
    }
  | { mode: 'message'; text: string };
