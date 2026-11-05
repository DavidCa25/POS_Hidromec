/**
 * wybix_bjsuper — personalización de B&J Super (abarrotes, León, Gto.).
 *
 * Marca de la propuesta 5 «Carrito Nuevo»: azul #1B2D7A, amarillo #FFD21F.
 *
 * Llena estos huecos del núcleo (src/app/marca/marca.ts):
 *   - mascota: Carri, el carrito del logo con gorra, sustituye a Wybix donde
 *     ya aparece la mascota y acompaña el cobro en Touch;
 *   - fondoTouch: el logo, casi transparente, detrás del catálogo de Touch;
 *   - menuEnLinea: el logo y los colores de la página del menú en línea;
 *   - tarjetaWallet: la tarjeta del Club con el azul y el amarillo.
 *
 * Y un ajuste de arranque (manifest.json): Venta suelta encendida, para el
 * cigarro de la cajetilla. El negocio puede apagarla en Aplicaciones.
 *
 * Nada de aquí toca archivos del núcleo.
 */
import type { AddonWybix, MascotaDeMarca } from '../../src/app/marca/marca';
import type { EstadoMascota } from '../../src/app/wx-mascota/wx-mascota.component';

/* Carri no tiene motor propio: es el SVG de la marca con movimiento CSS.
   Los estados cambian el GESTO (respira, se asoma, brinca, tiembla), nunca
   el personaje. Con movimiento reducido se queda quieto. */
const ESTILO = `
.bj-carri{display:block;width:100%;height:100%;object-fit:contain;transform-origin:50% 90%}
.bj-carri--idle{animation:bj-respira 3.2s ease-in-out infinite}
.bj-carri--atencion{animation:bj-asoma .9s ease-in-out 2}
.bj-carri--exito{animation:bj-brinca .7s cubic-bezier(.3,1.6,.5,1) 2}
.bj-carri--error{animation:bj-tiembla .45s ease-in-out 2;filter:saturate(.55)}
@keyframes bj-respira{0%,100%{transform:translateY(0)}50%{transform:translateY(-2%)}}
@keyframes bj-asoma{0%,100%{transform:rotate(0)}30%{transform:rotate(-6deg)}70%{transform:rotate(4deg)}}
@keyframes bj-brinca{0%,100%{transform:translateY(0) scale(1)}40%{transform:translateY(-14%) scale(1.04)}}
@keyframes bj-tiembla{0%,100%{transform:translateX(0)}25%{transform:translateX(-4%)}75%{transform:translateX(4%)}}
@media (prefers-reduced-motion: reduce){.bj-carri{animation:none!important}}
`;

function ponerEstilo() {
  if (document.getElementById('bj-carri-estilo')) return;
  const s = document.createElement('style');
  s.id = 'bj-carri-estilo';
  s.textContent = ESTILO;
  document.head.appendChild(s);
}

async function cargarMascota(): Promise<MascotaDeMarca> {
  return {
    nombre: 'Carri',
    montar(host) {
      ponerEstilo();
      const img = document.createElement('img');
      img.src = 'assets/addon/carri.svg';
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.draggable = false;
      host.appendChild(img);
      const poner = (e: EstadoMascota) => { img.className = `bj-carri bj-carri--${e}`; };
      poner('idle');
      /* Un gesto pasajero vuelve a respirar al terminar. */
      img.addEventListener('animationend', () => poner('idle'));
      return {
        estado: poner,
        destruir: () => img.remove(),
      };
    },
  };
}

const addon: AddonWybix = {
  id: 'wybix_bjsuper',
  nombre: 'B&J Super',
  mascota: cargarMascota,
  mascotaEnTouch: true,
  fondoTouch: {
    claro: 'assets/addon/fondo-touch-claro.svg',
    oscuro: 'assets/addon/fondo-touch-oscuro.svg',
    tamano: '640px 420px',
  },
  menuEnLinea: {
    logo: 'assets/addon/menu-logo.svg',
    color: '#1B2D7A',
    acento: '#FFD21F',
  },
  /* El logo es azul y amarillo: sobre fondo claro se leen los dos. */
  tarjetaWallet: {
    fondo: '#F2F4FA',
    texto: '#1B2D7A',
    etiqueta: '#1B2D7A',
    logo: 'assets/addon/wallet-logo.svg',
  },
};

export default addon;
