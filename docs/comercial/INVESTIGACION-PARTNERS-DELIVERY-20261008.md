# Investigación: integrar Rappi, Uber Eats y DiDi Food — costos, agregadores y requisitos de partner

Fecha: 2026-10-08. Complementa `AUDITORIA-SISTEMA-DELIVERY-20261007.md`, que trata
la arquitectura dentro de Wybix. Este documento trata lo comercial y lo administrativo.

> Los precios vienen de fuentes públicas consultadas en octubre de 2026 y pueden
> estar desactualizados. Confirmar con cada proveedor antes de decidir.

---

## 1. ¿Se cobra por usar las APIs?

- **Las APIs de las plataformas no tienen costo por llamada** para un partner
  aprobado. Uber, Rappi y DiDi no cobran por integrarse.
- Lo que sí se cobra siempre, haya integración o no, es la **comisión de la
  plataforma al restaurante**: de 18 % a 35 % + IVA según plan y logística.
  La integración no la cambia.
- Lo que cuesta es **ser aprobado**: contrato, NDA, certificación y un piloto.
  Ese costo es tiempo, no dinero.

## 2. ¿Puede cada restaurante conectarse solo?

**No con llaves propias.** Ninguna de las tres entrega credenciales de API a un
restaurante. Las llaves son del **proveedor de software** (Wybix) y el
restaurante solo **autoriza** su tienda (OAuth o activación desde el portal de la
plataforma).

Rutas posibles, de la más barata a la más integrada:

| Paso | Qué es | Costo para Wybix | Costo para el restaurante | Automatización |
|---|---|---|---|---|
| 1. Captura manual mejorada | El cajero teclea el pedido de la tablet de la plataforma en Wybix con canal, precio de canal y pago `PLATAFORMA` | 0 | 0 | Ninguna; ya existe casi todo (canales, precios por canal, método `PLATAFORMA`) |
| 2. Agregador | Un tercero (Deliverect, Otter…) recibe los pedidos de todas las plataformas y los empuja a Wybix por **una** API | Integrar una sola API | Suscripción mensual al agregador | Pedidos entran solos |
| 3. Partner directo | Wybix certificado con cada plataforma; el restaurante conecta su tienda desde Owner | Certificación ×3 | 0 adicional | Total, incluido menú y estados |

**Recomendación:** Paso 1 ya, sin costo. Paso 2 cuando haya clientes que lo
pidan (el restaurante paga el agregador). Paso 3 empezando por Uber, que tiene
el proceso más documentado, cuando haya volumen que lo justifique.

## 3. Agregadores (middleware)

| Agregador | Precio público aproximado | Plataformas en México | API para POS | Notas |
|---|---|---|---|---|
| **Deliverect** | 79 / 99 / 149 USD al mes por sucursal + 199 USD de alta | DiDi, Rappi, Uber Eats | Sí, **POS partner API abierta**: formulario → llaves de staging → certificación | El camino más claro para un POS nuevo |
| **Ordatic** | ~€30 al mes + €0.15 por pedido | Dice tener presencia en México | Confirmar | Confirmar cobertura de DiDi y Uber y si expone API para POS |
| **Otter** | 89–219 USD al mes | Las tres | API pública vía ejecutivo de cuenta | Más orientado a cocinas fantasma |
| **Sinqro** | Sin precio público | Rappi confirmado | API para restaurantes | Revisar DiDi y Uber |
| PoloTab (POS competidor) | 1,490 MXN al mes con delivery incluido | — | — | Referencia de precio de mercado, no un proveedor |

**Cómo funciona con un agregador:**

1. El restaurante contrata el agregador y conecta allí sus tiendas de Rappi, Uber y DiDi.
2. Wybix se registra **una vez** como POS partner del agregador y obtiene llaves de staging.
3. El agregador manda cada pedido a un webhook de Wybix en la nube; la caja lo recibe por la bandeja descrita en la auditoría de arquitectura.
4. Wybix devuelve estados (aceptado, listo, entregado) y, si el agregador lo permite, el menú.
5. Certificación con el agregador y piloto con un restaurante.

Ventaja: una sola integración cubre las tres plataformas. Desventaja: el
restaurante paga una mensualidad extra.

## 4. ¿Qué tan difícil es que aprueben a Wybix como partner?

| Plataforma | Proceso | Dificultad |
|---|---|---|
| **Uber Eats** | Solicitud en el portal de desarrolladores → NDA + licencia de API → aprobación por escrito → sandbox → certificación | Media; el más documentado |
| **Rappi** | No es autoservicio: lo aprueba un contacto comercial; portal `dev-portal.rappi.com` | Media-alta; depende de tener contacto |
| **DiDi Food** | Formulario → negociación → NDA → calificación de partner → app de prueba → QA → piloto | Alta; proceso largo |

**La palanca más fuerte:** que un restaurante cliente (por ejemplo I Do Nut) lo
pida a su ejecutivo de la plataforma. Las plataformas priorizan integraciones
que sus restaurantes solicitan.

## 5. Documentos que probablemente pedirán

Ninguna plataforma publica una lista oficial. Lo habitual en procesos de partner en México:

- Acta constitutiva (o alta como persona física con actividad empresarial).
- RFC y constancia de situación fiscal.
- Comprobante de domicilio fiscal.
- Identificación oficial del representante legal.
- Descripción del producto y del flujo de pedidos (se puede adaptar `AUDITORIA-SISTEMA-DELIVERY-20261007.md`).
- Número de clientes y sucursales activas.
- Un restaurante piloto dispuesto a probar.
- Demo o video del POS.
- Políticas de seguridad y privacidad (aviso de privacidad, manejo de datos de clientes).

## 6. Guía del formulario de DiDi

Liga correcta: <https://developer.didi-food.com/es-MX/home>.

**Primer formulario ("Tell us more"):**

- Si pide **CNPJ**, la región está en Brasil (CNPJ es el registro brasileño). Cambiar la región a **México**.
- **Primary Service Area:** una zona geográfica, por ejemplo "León, Gto."
- **Marca preferida:** DiDi Food.

**Segundo formulario ("Información de la empresa"):**

| Campo | Qué poner |
|---|---|
| Perfil de la empresa | Wybix POS es un punto de venta para restaurantes y comercios en México: caja Windows, KDS, tablets y app del dueño. Buscamos recibir pedidos de DiDi Food directamente en caja y cocina, sin recapturar. |
| Marca principal | Wybix POS |
| RFC | El RFC real de la empresa o persona física |
| Empleados / tiendas | Cifras reales; no inflarlas |
| Persona a cargo | Jesús David Casillas Rios |
| Contacto | El medio que realmente se atienda |

Los formularios los llena y envía el usuario; Claude no los envía.

## 7. Qué no hacer

- No pedir ni guardar usuario y contraseña del portal de la plataforma del restaurante para "leer" pedidos: viola términos de servicio y es frágil.
- No prometer integración automática a clientes antes de tener aprobación.
- No construir los tres conectores directos a la vez: empezar por el agregador o por Uber.
