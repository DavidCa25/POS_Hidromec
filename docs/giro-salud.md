# Giro Salud · investigación y arquitectura

Estado: **fases 1 a 4 construidas** (Farmacia, Consultorio, Dental,
Laboratorio e Imagen) en la rama `feat/giro-salud`. Las integraciones (fase
5) siguen como investigación. Fecha: 2026-11-19.

## 0. Lo construido

| Pieza | Dónde |
| --- | --- |
| Esquema: config, ficha sanitaria, lotes, movimientos, recetas surtidas, temperaturas, pacientes, documentos, adendas, diagnósticos, CIE-10 (selección), bitácora, profesionales, estudios, órdenes de estudios, odontograma, planes | `sql/schema/changes/0087_salud.sql` |
| 39 procedimientos `sp_salud_*` | `sql/procedures/salud/`; migración `0087_salud.sql` (`sp_salud_estudios_catalogo` va en `0088_iva-exento.sql` porque lee `iva_exento`) |
| Inmutabilidad: trigger en documentos y diagnósticos firmados y en resultados validados; bitácora append-only | mismo DDL |
| Giros de Salud: Farmacia, Consultorio, Dental, Farmacia con consultorio, Laboratorio clínico, Rayos X e imagen | `electron/salud/presets.json` |
| Giro de Servicios «Consultorio de salud» (la agenda y el cobro de la clínica y de los estudios) | `electron/servicios/presets.json`, `demo-profiles/servicios/seeds/SALUD.sql` |
| Canales `salud:*`, ganchos de la venta (receta antes, FEFO después) | `electron/ipc/salud.js`, `electron/main.js` |
| Paquetes `SALUD_FARMACIA` (Encargado) y `SALUD_EXPEDIENTE` (Administrador; se otorga a cada médico, químico o radiólogo) | `electron/seguridad/permisos.js`, `canales.js` |
| Entitlement `health` y giro `HEALTH`; la Pantalla del día del personal de una licencia solo de Salud consume la cuota de Salud | `electron/licencia/entitlements.js` |
| Giro Salud en el alta del negocio: pide la prueba de 30 días con `HEALTH` | `src/app/setup-inicial/` |
| Pantallas: Farmacia, Caducidades, Libro de control, Temperaturas, Pacientes, Expediente, Odontograma, Planes, Estudios, Orden de estudios, Catálogo de estudios, Mis datos de firma | `src/modulo-salud/` (chunks propios; dental con `@defer`) |
| Diálogo de receta en la caja (Retail y Touch), cargado con `import()` | `src/core/receta-dialogo.ts` |
| IVA exento distinto de tasa 0 (producto, factura, nube) | `sql/schema/changes/0088_iva-exento.sql`, Inventario, `factura-nueva` |
| Pruebas de extremo a extremo | `e2e/salud.spec.js` (`npm run e2e:salud`) |

**Quién firma.** Cada usuario que atiende pacientes captura en «Mis datos de
firma» su nombre, cédula profesional, institución del título y, si la tiene,
especialidad con su cédula (`salud_profesionales`). Al firmar un documento o
validar un resultado esos datos y los del establecimiento se **copian** al
registro (`firmante`) y entran en su huella: cambiar la cédula después no
altera lo firmado. Una receta sin cédula no se firma (`SIN_CEDULA`), y la
pantalla pide los datos ahí mismo. La receta impresa lleva el membrete con
todo eso.

**Laboratorio e imagen.** Un estudio es un servicio del catálogo con su ficha
(`salud_estudios`): laboratorio con parámetros, unidades y valores de
referencia, o imagen con modalidad (rayos X, mastografía, ultrasonido,
densitometría, tomografía, resonancia). La orden de estudios abre en la misma
transacción una orden de servicio, que se cobra en la caja. Cada estudio
avanza solo: solicitado → tomado → capturado → validado. La base pone la
bandera de fuera de rango (A/B). Validar exige cédula, copia al firmante,
calcula la huella y desde ahí el resultado no cambia. Mastografía exige
BI-RADS. La orden queda lista cuando todo está validado y se entrega; abrir,
pedir, validar y entregar quedan en la bitácora del paciente.

**IVA exento (0088).** `products.iva_exento` distingue los honorarios médicos
y dentales (exentos, art. 15 fr. XIV LIVA) de la tasa 0 (medicinas). Inventario
ofrece las dos opciones; la factura rehace los conceptos desde la venta cuando
alguno es exento y manda `taxExempt`; la nube (wybix-owner,
`_shared/fiscal.ts`) emite `TipoFactor Exento`. Al hacerlo se corrigió otro
defecto: una tasa 0 salía como objeto de impuesto **sin traslado**, que el SAT
rechaza; ahora lleva `Tasa 0.000000`.

**Fuera de este repositorio (wybix-owner, rama `feature/giro-salud`, sobre
`feature/cfdi-ieps`):**

- `supabase/migrations/20261119120000_giro_salud.sql`: `VERTICAL_HEALTH` en
  `license_catalog` con `health` y lo que el consultorio usa de Servicios;
  los checks de giro aceptan `HEALTH`; `license_add_vertical` y
  `license_trial_select_vertical` validan contra el catálogo y no contra una
  lista fija. Prueba: `npm run test:giro-salud` (Docker). **No se ha aplicado
  a producción.**
- `supabase/functions/_shared/fiscal.ts`: exento y tasa 0 en el CFDI. Prueba:
  `_shared/test/fiscal-exento.test.ts`.

**Pendiente:**

- **Aplicar la migración de Supabase** en producción y desplegar `fiscal.ts`
  (la Edge Function de timbrado). Hasta entonces solo la demo y las pruebas
  tienen Salud, y la nube timbra tasa 0 donde el POS ya dice exento.
- **Precio** de `VERTICAL_HEALTH` como giro adicional (`license_catalog_update`).
- **Partidas repetidas al cobrar una orden.** La caja junta dos partidas del
  mismo servicio en una línea con un precio. Al aceptar un plan, cada
  procedimiento escrito a mano se vuelve su propio servicio para evitarlo,
  pero el mismo servicio del catálogo con dos precios distintos en un plan
  sigue juntándose (comportamiento existente de Servicios).
- **Imagen:** Wybix guarda el informe, no las placas (no es PACS). Valores de
  referencia por sexo y edad, etiquetas de muestra con código de barras,
  envío del PDF por WhatsApp e interfaces con equipos (ASTM/HL7, DICOM
  Worklist) quedan para la fase 5.

**Manifiesto y baseline:** regenerados con 0087 y 0088 (`sql/manifest.json`,
`sql/schema/tables/`, `sql/triggers/`, `installer/template.bak`);
`npm run db:prepare-release` pasa completo.

**Arnés e2e:** con `WYBIX_E2E=1` y sin `WYBIX_FUNCIONES_URL`, la caja ya no
refresca la licencia contra el servidor real: antes, al iniciar sesión,
reemplazaba el certificado del arnés por el de la computadora de quien
corría las pruebas.

Objetivo: un cuarto giro de Wybix para negocios de salud: farmacias,
consultorios médicos, consultorios dentales, gabinetes de imagen (rayos X,
mastografía, ultrasonido) y laboratorios clínicos.

Las normas citadas se revisaron en fuentes secundarias (guías estatales,
tesis, despachos). **Antes de construir cada fase, alguien tiene que leer el
texto vigente en el DOF** y, para lo sanitario, confirmar con COFEPRIS o la
autoridad estatal. Donde una afirmación no se pudo confirmar, el documento lo
dice.

---

## 1. Decisión de forma

**Un giro nuevo, `VERTICAL_HEALTH` («Para Salud»), con presets**, igual que
Servicios usa `electron/servicios/presets.json`:

| Preset | Ejemplos | Motor principal |
| --- | --- | --- |
| `FARMACIA` | Farmacia, botica, farmacia con consultorio | Venta de comercio + lotes y receta |
| `CONSULTORIO` | Medicina general, pediatría, ginecología, especialidades | Agenda + expediente |
| `DENTAL` | Consultorio dental, ortodoncia | Agenda + expediente + odontograma + plan de tratamiento |
| `IMAGEN` | Rayos X, mastografía, ultrasonido, tomografía | Órdenes de estudio + informe |
| `LABORATORIO` | Laboratorio clínico, toma de muestras | Órdenes de estudio + resultados |
| `OTRO` | Fisioterapia, nutrición, psicología, óptica | Agenda + expediente simple |

**Por qué un giro y no un preset de Servicios.** Salud trae obligaciones que
ningún otro giro tiene: expediente que no se puede borrar, datos sensibles,
receta, medicamentos controlados, caducidades. Meterlo en Servicios
obligaría a poner `if (preset === 'DENTAL')` dentro del núcleo de servicios.
Como giro propio, reutiliza los motores de Comercio y Servicios por
composición y agrega sus módulos sin tocar los demás.

**Por qué un solo giro y no cinco.** Los negocios reales se mezclan: farmacia
con consultorio, clínica con dental y rayos X, laboratorio con toma de
mastografía. Un solo giro con módulos encendidos por preset cubre eso con una
licencia. Es la misma regla que ya usa el modelo comercial: «un solo precio
para todos los servicios».

Licencia: `VERTICAL_HEALTH` se agrega a `license_catalog` (Supabase) y a
`license_verticals`. Un negocio puede combinarlo con `VERTICAL_COMMERCE`
(farmacia que también vende abarrotes) como cualquier híbrido.

---

## 2. Qué ya existe y se reutiliza

| Pieza de Wybix | Dónde | Uso en Salud |
| --- | --- | --- |
| Venta con código, inventario, compras, proveedores | Giro Comercio | Farmacia completa, insumos del consultorio |
| Compra por foto de ticket o XML de factura | `electron/ocr/`, `compras-documentos` | Entrada de medicamento; el XML trae lote solo a veces, se completa a mano |
| Agenda, citas, profesionales, horarios, ausencias | `sql/procedures/servicios/sp_appointment_*`, `sp_professional_*` | Citas de consulta y de estudios |
| Órdenes de servicio con líneas, estados, eventos, autorización, cobro | `sp_service_order_*` | Consulta, plan dental, orden de estudio |
| Presets de giro con textos propios | `electron/servicios/presets.json` | Patrón para los presets de Salud |
| Clientes con fecha de nacimiento, RFC, régimen, uso CFDI | `customers` | Base del paciente (más campos, ver §4) |
| «Activos» del cliente | `customer_assets` | **No** se usa para el paciente; el paciente es el cliente |
| Crédito y abonos | `pago-con-credito.md` | Planes dentales en pagos |
| Avisos por WhatsApp | `whatsapp-avisos-panel`, `electron/ipc/whatsapp.js` | Recordatorio de cita, resultados listos |
| Facturación CFDI | `factura-nueva`, `facturacionConfig-panel` | Honorarios y medicamentos (ver §8, falta exento) |
| PDF con el Chromium de Electron | `electron/pdf/printToPdfElectron.js` (ADR-002) | Receta, informe, resultados, consentimiento |
| Comisiones por profesional | `sp_commissions_report` | Pago a médicos que rentan consultorio |
| MultiSucursal, Mis empresas | `docs/multisucursal.md`, `docs/multiempresa.md` | Cadenas de farmacias, clínicas con varias sedes |
| Asistente | `electron/asistente/` | Consultas de operación; **nunca** diagnóstico (ver §9) |
| Pantallas Operativas | `docs/licensing.md` | Sala de espera, consultorio, toma de muestras |

---

## 3. Módulos nuevos

### 3.1 Farmacia

**Lotes y caducidades.** Hoy `products` no tiene lote ni caducidad. Hace
falta:

- Existencia por lote: producto, lote, caducidad, cantidad, costo.
- Venta con salida **primero en caducar, primero en salir**. Las guías de
  verificación estatales lo revisan como falta mayor.
- Alerta de próximos a caducar (90/60/30 días) y reporte de caducados para
  merma o devolución al proveedor.
- La compra (manual, foto o XML) pide lote y caducidad por renglón de
  medicamento.

**Clasificación sanitaria por producto.** Campo `fraccion_lgs` (I a VI del
art. 226 de la Ley General de Salud) y banderas `es_antibiotico`,
`requiere_refrigeracion`, `sustancia_activa`, `presentacion`,
`registro_sanitario`.

- Fracciones I a III: controlados (estupefacientes y psicotrópicos). Guarda
  y custodia desde la recepción hasta la venta, libro de control autorizado y
  foliado, responsable sanitario.
- Fracción IV y antibióticos: receta obligatoria. Para antibióticos la
  farmacia registra la receta, la sella y la conserva (una guía de Veracruz
  2025 dice al menos 365 días; confirmar).
- Fracciones V y VI: venta libre o en farmacia sin receta.

**Venta con receta.** Al escanear un producto que la requiere, la venta pide
antes de cobrar:

- Datos de la receta: médico, cédula profesional, fecha, institución o
  domicilio.
- Para antibióticos: «retiene» o «sella y devuelve», y para fracción III los
  surtidos que quedan.
- Foto de la receta (opcional, usa el mismo flujo de foto que compras).

**Libros de control.** Wybix genera el registro de entradas y salidas de
controlados y antibióticos y lo imprime en el formato del libro. **No está
confirmado que COFEPRIS acepte un libro electrónico en lugar del libro
autorizado**: en la primera versión Wybix es el auxiliar que llena el libro,
no el libro.

**Búsqueda por sustancia activa.** «Paracetamol 500» encuentra la marca y
los genéricos. Al no haber existencia, el sistema sugiere un equivalente con
la misma sustancia y presentación.

**Bitácora de temperatura** del refrigerador y del local (las guías piden el
local a no más de 30 °C). Registro dos veces al día con responsable. Pantalla
Operativa opcional.

**Precio máximo al público** impreso en el empaque: aviso si el precio de
venta lo supera.

### 3.2 Expediente clínico (consultorio, dental, imagen, laboratorio)

Base: NOM-004-SSA3-2012 (contenido y conservación del expediente) y, para el
sistema que lo guarda, NOM-024-SSA3-2012 (ver §6).

**Paciente.** Es el `customer`, con una ficha clínica aparte:

- Identificación: nombre, sexo, fecha de nacimiento, CURP, domicilio,
  teléfono, contacto de emergencia, tutor si es menor.
- Antecedentes: heredofamiliares, personales patológicos y no patológicos,
  gineco-obstétricos, alergias, medicamentos actuales.
- Las alergias se ven siempre, arriba, en cualquier pantalla del paciente.

**Documentos del expediente** (cada uno con autor, fecha y hora):

| Documento | Contenido mínimo |
| --- | --- |
| Historia clínica | Interrogatorio, exploración, diagnósticos, plan |
| Nota de evolución | Formato SOAP: subjetivo, objetivo con signos vitales, análisis con diagnóstico CIE-10, plan |
| Nota de interconsulta o referencia | A quién se envía y por qué |
| Receta médica | Médico, cédula, institución o domicilio, fecha, medicamento, dosis, vía, frecuencia, duración, firma |
| Solicitud de estudios | Estudios de laboratorio o gabinete |
| Consentimiento informado | Procedimiento, riesgos y beneficios, firma del paciente o tutor, del médico y de testigos |
| Resultados e informes | Los que genere imagen o laboratorio, o los que el paciente traiga |
| Archivos | Fotos, PDF, radiografías traídas por el paciente |

**Reglas de datos:**

1. **Lo firmado no se edita ni se borra.** Una nota cerrada solo admite una
   adenda con su propio autor y fecha. El expediente se conserva al menos
   cinco años desde el último acto médico (confirmar el cómputo para
   menores).
2. **Bitácora de acceso**: quién abrió, imprimió o exportó qué expediente y
   cuándo.
3. **Permisos por rol**: el cajero cobra la consulta pero no lee la nota; el
   médico ve sus pacientes; la recepción ve agenda y datos de contacto.
4. **Diagnóstico con catálogo CIE-10**, con búsqueda por texto.
5. **Firma**: en la primera versión, firma del usuario autenticado más firma
   autógrafa capturada en pantalla para el consentimiento. La e.firma (FIEL)
   queda para cuando se busque NOM-024.

**Receta impresa** con logotipo, datos del médico y código QR de
verificación. Si la farmacia del mismo negocio usa Wybix, la receta se surte
desde la venta con un escaneo.

### 3.3 Dental

Base: NOM-013-SSA2-2015, que pide su propio expediente dental (confirmar el
numeral 9.3 en el DOF).

- **Odontograma** con numeración FDI (dientes 11 a 48 y temporales 51 a
  85), estado por diente y por cara (caries, obturación, ausente, corona,
  endodoncia…). Historial: el odontograma de cada visita se guarda, no se
  pisa.
- **Plan de tratamiento**: procedimientos por diente, en fases, con
  presupuesto. Al aceptarlo, se vuelve una orden de servicio con líneas, y el
  paciente paga en abonos con el crédito que ya existe.
- **Periodontograma**: segunda versión.
- Consentimiento informado por procedimiento (extracción, endodoncia,
  implante).
- Radiografías periapicales y panorámicas como archivos del expediente.
- Recordatorio de limpieza cada seis meses.

### 3.4 Imagen: rayos X, mastografía, ultrasonido

Base: NOM-229-SSA1-2002 (instalaciones, equipos y protección radiológica en
rayos X; hay un proyecto de revisión) y NOM-041-SSA2-2011 (cáncer de mama).

**Wybix no es un PACS.** Las imágenes DICOM se quedan en el equipo o en el
PACS del gabinete. Wybix lleva todo lo que rodea al estudio:

1. **Orden de estudio**: paciente, estudio del catálogo, médico que lo
   solicita, preparación indicada, cobro o convenio.
2. **Lista de trabajo**: pacientes del día por sala y equipo. Más adelante,
   DICOM Modality Worklist para que el equipo reciba nombre e ID sin
   capturar.
3. **Toma**: técnico, hora, proyecciones; dosis si el equipo la reporta.
4. **Informe** del radiólogo con plantillas por estudio. Para mastografía,
   categoría **BI-RADS 0 a 6** obligatoria en el formulario.
5. **Entrega**: PDF del informe por WhatsApp o impreso, con liga al visor del
   PACS si el gabinete la tiene.

**Seguimiento de mastografía**: la NOM-041 pide referir a un servicio de
patología mamaria a las pacientes con BI-RADS 4 o 5. Wybix lista a las
pacientes con 0, 4 o 5 que no tienen cita de seguimiento, y recuerda el
tamizaje cada dos años (confirmar el intervalo en la norma).

### 3.5 Laboratorio clínico

Base: NOM-007-SSA3-2011 (no se pudo revisar en esta investigación).

- Catálogo de estudios y perfiles, con analitos, unidades y valores de
  referencia por sexo y edad.
- Orden, toma de muestra con etiqueta de código de barras, estado de la
  muestra.
- Captura de resultados, marca de valores fuera de rango, **validación por
  el químico responsable** antes de liberar.
- Reporte PDF con firma del responsable y entrega por WhatsApp.
- Equipos de laboratorio con interfaz (ASTM/HL7): fase posterior.

### 3.6 Seguimiento

Una sola pantalla de pendientes clínicos, que el asistente también lee:

| Pendiente | Origen |
| --- | --- |
| Citas de mañana sin confirmar | Agenda |
| Resultados listos sin entregar | Imagen y laboratorio |
| BI-RADS 0, 4 o 5 sin seguimiento | Imagen |
| Planes dentales con fases pendientes o abonos atrasados | Dental y crédito |
| Pacientes que tocan control (limpieza a 6 meses, tamizaje a 2 años, control de crónicos) | Expediente |
| Medicamento próximo a caducar | Farmacia |
| Receta de fracción III con surtidos pendientes | Farmacia |

Los avisos al paciente salen por el canal de WhatsApp que ya existe, con
plantillas que no incluyen diagnósticos (ver §7).

---

## 4. Modelo de datos (borrador)

Tablas nuevas, con el prefijo `salud_` para que ningún otro giro las toque:

```
salud_pacientes          customer_id PK/FK, curp, sexo, tutor_customer_id,
                         contacto_emergencia, alergias, grupo_sanguineo,
                         consentimiento_datos_at, consentimiento_datos_por
salud_antecedentes       paciente_id, tipo, texto, registrado_por, registrado_at
salud_documentos         id, paciente_id, tipo (HISTORIA|NOTA|RECETA|SOLICITUD|
                         CONSENTIMIENTO|INFORME|RESULTADO|ARCHIVO),
                         profesional_id, cita_id, orden_id, contenido_json,
                         estado (BORRADOR|FIRMADO), firmado_at, hash
salud_adendas            documento_id, texto, autor_id, at
salud_diagnosticos       documento_id, cie10, descripcion, principal
salud_receta_lineas      documento_id, product_id NULL, sustancia, dosis, via,
                         frecuencia, duracion, cantidad
salud_archivos           documento_id, ruta_local, mime, sha256, bytes
salud_bitacora_acceso    usuario_id, paciente_id, documento_id, accion, at
salud_odontograma        paciente_id, documento_id, diente, cara, estado
salud_plan_tratamiento   paciente_id, orden_id, fase, diente, procedimiento,
                         precio, estado
salud_estudios           catalogo: clave, nombre, area (IMAGEN|LAB), preparacion,
                         plantilla_informe
salud_estudio_ordenes    orden_id, estudio_id, estado, tecnico_id, radiologo_id,
                         birads, informe_documento_id
salud_lab_analitos       estudio_id, clave, unidad, ref_min, ref_max, sexo, edad
salud_lab_resultados     estudio_orden_id, analito_id, valor, fuera_rango,
                         validado_por, validado_at

-- Farmacia (extiende productos e inventario de Comercio)
product_lotes            product_id, lote, caducidad, cantidad, costo
salud_producto_sanitario product_id PK, fraccion_lgs, es_antibiotico, sustancia_activa,
                         presentacion, registro_sanitario, refrigeracion, precio_maximo
salud_recetas_surtidas   sale_id, medico, cedula, fecha_receta, retenida,
                         surtidos_restantes, foto_ruta
salud_libro_control      product_id, lote, tipo (ENTRADA|SALIDA), cantidad, sale_id,
                         purchase_id, receta_id, saldo, at
salud_temperaturas       equipo, grados, registrado_por, at
```

Reglas del modelo:

- `salud_documentos` con estado `FIRMADO` no se actualiza: el procedimiento
  lo rechaza y solo acepta `salud_adendas`. El `hash` del contenido firmado
  permite comprobar después que no cambió.
- `product_lotes` convive con `products.stock`: la existencia del producto es
  la suma de sus lotes cuando el producto tiene control por lote.
- Los procedimientos van en `sql/procedures/salud/` y las migraciones en
  `electron/migrations/` como todo lo demás.

---

## 5. Pantallas

| Pantalla | Para quién |
| --- | --- |
| Agenda del consultorio (reutiliza la de Servicios) | Recepción, médico |
| Sala de espera (Pantalla Operativa): turno y consultorio | Pacientes |
| Consulta: ficha del paciente, alergias, nota SOAP, receta, cobro | Médico |
| Odontograma y plan de tratamiento | Dentista |
| Lista de trabajo de imagen y captura de informe | Técnico, radiólogo |
| Laboratorio: muestras, captura, validación | Químico |
| Venta de farmacia con receta y lote | Cajero |
| Caducidades, libro de control, temperaturas | Responsable sanitario |
| Seguimiento | Dueño, recepción |

Todas consumen el Design System (`wx-select`, `wx-date`, `wx-dialogo`…).
Ningún `<select>` nativo.

---

## 6. NOM-024 y certificación

La NOM-024-SSA3-2012 pone requisitos técnicos a los sistemas que guardan
expediente electrónico (SIRES): catálogos normados (CIE-10, CLUES),
estándares de intercambio (HL7 CDA), autenticación, autorización y bitácora
de auditoría, y firma electrónica. Un expediente electrónico tiene validez
plena cuando el sistema cumple esa norma, y existe un procedimiento de
certificación.

Decisión propuesta:

- **Primera versión: diseñada para cumplir, sin certificar.** Bitácora,
  inmutabilidad, permisos, CIE-10 y CURP desde el inicio, para no tener que
  rehacer el modelo.
- **La certificación es un proyecto aparte**, con costo y tiempo propios. Se
  decide cuando haya clientes que la pidan (clínicas que trabajan con
  aseguradoras o con gobierno suelen pedirla).
- Mientras no esté certificado, Wybix no se vende como «expediente clínico
  electrónico certificado» y se le dice al cliente que conserve el respaldo
  impreso de lo que la norma le exija.

---

## 7. Privacidad y seguridad

La nueva Ley Federal de Protección de Datos Personales en Posesión de los
Particulares está vigente desde el 21 de marzo de 2025 (última reforma DOF
14-11-2025). Los datos de salud son **sensibles**: requieren consentimiento
expreso y por escrito (confirmar en el texto oficial) y aviso de privacidad.

Lo que eso pide al sistema:

- **Consentimiento al dar de alta al paciente**, firmado en pantalla y
  guardado con fecha (`salud_pacientes.consentimiento_datos_at`).
- **Plantilla de aviso de privacidad** que el negocio llena e imprime.
- **Cifrado** de la base local en reposo y de los archivos clínicos.
- **Nada clínico sale a la nube por defecto.** La sincronización actual
  manda ventas, cortes y alertas a la app del dueño. Para Salud se mandan
  montos y número de consultas, nunca notas, diagnósticos ni resultados. Si
  más adelante hay portal de pacientes o expediente compartido entre
  sucursales, eso es una decisión aparte, con cifrado y bitácora.
- **WhatsApp sin diagnósticos.** El mensaje dice «Sus resultados están
  listos» con una liga que pide un dato para abrir. Nunca el resultado en el
  texto.
- **El asistente** puede responder «¿cuántas consultas hubo hoy?» pero no
  lee expedientes ni sugiere diagnósticos o dosis.
- Respaldo cifrado obligatorio: perder un expediente es un incumplimiento,
  no solo un problema técnico.

---

## 8. Impuestos y facturación

| Concepto | IVA | Nota |
| --- | --- | --- |
| Medicinas de patente | Tasa 0% | Art. 2-A LIVA |
| Honorarios de médico, dentista o veterinario persona física (o sociedad civil de ellos) con título | **Exento** | Art. 15 fr. XIV LIVA y art. 41 de su Reglamento |
| Psicología, nutrición, fisioterapia | 16% | Criterios recientes; confirmar caso por caso |
| Servicios de una S.A. (clínica como sociedad mercantil) | 16% | La exención es para personas físicas |
| Productos de higiene, cosméticos, abarrotes | 16% | |

**Resuelto en 0088:** `products.iva_exento` separa exento de tasa 0. En el
CFDI exento se emite con `TipoFactor = Exento` y tasa 0 con `Tasa` 0.000000
(ver §0). El ticket no cambia: los dos cobran 0 de IVA.

Deducciones personales del paciente: los honorarios médicos y dentales se
deducen si se pagan por medio bancarizado y con CFDI. **No se confirmó en
esta investigación**; revisar LISR y Resolución Miscelánea 2026. Si se
confirma, la venta avisa cuando un honorario se cobra en efectivo.

---

## 9. Lo que Wybix no hace

- No diagnostica, no sugiere tratamiento ni dosis.
- No es PACS ni visor DICOM.
- No sustituye el libro de control autorizado mientras COFEPRIS no acepte el
  electrónico.
- No es expediente certificado NOM-024 hasta que se certifique.
- No trabaja con aseguradoras (pre-autorizaciones, convenios) en la primera
  versión.

---

## 10. Fases

| Fase | Contenido | Por qué en este orden |
| --- | --- | --- |
| **1. Farmacia** | Lotes y caducidades, clasificación sanitaria, venta con receta, libro de control auxiliar, sustancia activa, temperatura, exento vs 0% | Es Comercio con extras: el motor ya existe y es el mercado más grande |
| **2. Consultorio** | Paciente, consentimiento de datos, historia clínica, nota SOAP, CIE-10, receta impresa, bitácora, permisos, seguimiento | Reutiliza agenda y órdenes de Servicios |
| **3. Dental** | Odontograma, plan de tratamiento con presupuesto y abonos, consentimientos | Se monta sobre el expediente de la fase 2 |
| **4. Imagen y laboratorio** | Catálogo de estudios, órdenes, lista de trabajo, informes con BI-RADS, resultados con validación, entrega | Requiere el expediente y es el más especializado |
| **5. Integraciones** | DICOM Modality Worklist, interfaces de equipos de laboratorio, e.firma, certificación NOM-024 | Solo con clientes que lo pidan |

Cada fase cierra con su preset en `presets.json` de Salud, su recorrido de
Wybix Guide en `src/app/wx-guide/escenarios.ts` y su catálogo de prueba en
`scripts/giros/` (como `fruteria.mjs`).

---

## 11. Preguntas abiertas

1. ¿COFEPRIS acepta libro de control electrónico? ¿Con qué requisitos?
2. ¿Cuánto tiempo y costo tiene la certificación NOM-024 para un sistema
   local (no en la nube)?
3. Texto vigente del Suplemento de la FEUM para farmacias: edición y
   registros exigidos.
4. Requisitos de informe de la NOM-007-SSA3-2011 (laboratorio).
5. Plazo de conservación de recetas de antibióticos y de fracción III.
6. Deducibilidad de honorarios médicos en 2026 y forma de pago exigida.
7. Precio de `VERTICAL_HEALTH` en `license_catalog`.
8. ¿El primer cliente es farmacia o consultorio? Define si la fase 1 se
   queda o se cambia por la 2.

---

## Fuentes

Revisadas para esta investigación. Las marcadas como secundarias deben
contrastarse con el DOF.

- NOM-004-SSA3-2012, texto oficial: https://www.gob.mx/cms/uploads/attachment/file/512094/NOM-004-SSA3-2012.pdf
- NOM-024-SSA3-2012, DOF: https://dof.gob.mx/normasOficiales/4956/SALUD1/SALUD1.html
- NOM-024 y SIRES (secundaria): https://www.medesk.net/es/blog/norma-oficial-mexicana-para-el-expediente-clinico/
- NOM-013-SSA2-2015, DOF: https://dof.gob.mx/nota_detalle_popup.php?codigo=5462039
- NOM-013-SSA2-2015, PDF: https://www.gob.mx/cms/uploads/attachment/file/512101/NOM-013-SSA2-2015.pdf
- NOM-229-SSA1-2002 (ficha): https://platiica.economia.gob.mx/normalizacion/nom-229-ssa1-2002/
- NOM-041-SSA2-2011, PDF: https://www.gob.mx/cms/uploads/attachment/file/512079/NOM-041-SSA2-2011.pdf
- BI-RADS 4 y 5 y NOM-041 (secundaria): https://www.scielo.org.mx/pdf/gmm/v157n2/0016-3813-gmm-157-2-174.pdf
- Medicamentos controlados, FEUM: https://farmacopea.org.mx/Repositorio/Documentos/785.pdf
- Libros de control (PNO, secundaria): https://www.pediatria.gob.mx/archivos/normateca/PNO-FAR-28.docx
- Receta de antibióticos, Veracruz 2025: https://www.ssaver.gob.mx/proteccioncontrariesgossanitarios/wp-content/uploads/sites/10/2025/06/LA-RECETA-SI-IMPORTA-2025-.pdf
- Requisitos de farmacias, Veracruz 2025: https://www.ssaver.gob.mx/proteccioncontrariesgossanitarios/wp-content/uploads/sites/10/2025/04/REQUISITOS-FARMACIAS-2025.pdf
- Verificación de farmacias, Tabasco: https://tabasco.gob.mx/sites/default/files/users/userssaludtabasco/4.%20Cumplimiento%20de%20la%20Regulaci%C3%B3n%20Sanitaria%20para%20Farmacias%2C%20Boticas%20y%20Droguer%C3%ADas..pdf
- Guía de farmacias, Puebla: https://ss.puebla.gob.mx/images/areas/dpris/Guias/SAYO/011%20Para%20Farmacias%2C%20Boticas%20y%20Droguer%C3%ADas.pdf
- LFPDPPP vigente: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf
- Nueva LFPDPPP 2025 (secundaria): https://www.garrigues.com/es_ES/noticia/mexico-nueva-ley-federal-proteccion-datos-personales-posesion-particulares-introduce
- Exención art. 15 fr. XIV LIVA (secundaria): https://praxiumconsultores.com/blog/art-15-xiv-liva-exencion-de-servicios-medicos
- Psicólogos y IVA (secundaria): https://praxiumconsultores.com/blog/psicologos-cobran-iva-la-exencion-medica-no-los-incluye
- Reglamento LIVA art. 41: https://mley.mx/Reg_LIVA/articulo/41/
- Competencia, SICAR farmacia: https://fichas.sicar.mx/PDFs/Ficha_Farmacia.pdf
- Competencia, Aspel SAE farmacias: https://www.siigo.com/mx/sistema-administrativo-empresarial-aspel-sae/farmacias/
