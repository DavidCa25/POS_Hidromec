# Socios y propinas

Dos aplicaciones nuevas del núcleo. Nacen de Focus (David tiene la comida, Leo
las bebidas, cada quien compra lo suyo) pero sirven a cualquier negocio con
más de un dueño. El núcleo no nombra a ningún cliente.

- **Socios** (`socios`): de quién es cada producto e insumo, cuánto le toca a
  cada socio de cada venta, cómo se reparten los gastos, anticipos, retiros y
  liquidación por periodo.
- **Propinas** (`propinas`): cobrar propina al pagar y repartirla al personal.

## 1. Socios

### 1.1 Socios

- De **2 a 10** socios activos. Cada uno con nombre y, si se quiere, el
  usuario de Wybix con el que entra.
- Un socio no se borra: se desactiva. Lo que ya se repartió se queda.
- Cada socio puede ver lo de todos (permiso `SOCIOS_VER`).

### 1.2 A quién pertenece cada producto

- Un producto (que se vende o que es insumo) pertenece a uno o más socios con
  porcentaje. La suma es 100%.
- Se asigna por **categoría** y se puede cambiar por **producto**. Lo del
  producto gana.
- Sin dueño (ni producto ni categoría): al socio que diga la configuración, o
  por partes iguales.
- Quien es dueño de un **insumo** es quien lo compra. Quien es dueño de un
  **producto que se vende** es quien lo vende.

### 1.3 Cómo se reparte una venta

Cada renglón del ticket se reparte por separado. Un **combo** ya llega a la
venta como un renglón por componente (sándwich y frappé por su lado), con el
descuento del combo prorrateado por precio. No hay regla aparte para combos.

Para cada renglón:

1. **Ingreso** = cantidad × precio cobrado.
2. **Costo de cada socio** = lo que valen, al costo del momento de la venta,
   los insumos suyos que gastó el renglón (los movimientos de inventario de esa
   venta). Si el producto no tiene receta, su propio costo es del dueño del
   producto.
3. **Ganancia** = ingreso − costo total. Puede ser negativa.
4. Cada socio recibe **su costo de vuelta** más **su parte de la ganancia**.

La parte de la ganancia sale de la regla que elige el negocio:

| Regla | Parte de la ganancia de cada socio |
|---|---|
| **A. Quien vende** | Toda, según quién es dueño del producto vendido |
| **B. Quien aporta** | Según cuánto puso cada quien en insumos |
| **C. Mixta** | Un % fijo a quien vende, el resto según lo que aportó |

Con C al 100% es A; con C al 0% es B. Por eso se guarda un solo número,
`pct_vende`.

Ejemplo: sándwich $80; insumos $40 (Leo $30, David $10); lo vende David.

| Regla | David | Leo |
|---|---|---|
| A | $10 + $40 = $50 | $30 + $0 = $30 |
| B | $10 + $10 = $20 | $30 + $30 = $60 |
| C 30% | $10 + $12 + $7 = $29 | $30 + $21 = $51 |

El reparto de cada renglón **se congela** al registrarse. Cambiar la regla,
el dueño o un costo después no reescribe lo ya vendido.

Las **devoluciones** se reparten igual que la venta original, en negativo,
en proporción a lo devuelto.

### 1.4 Gastos

- Al registrar un gasto se pregunta **a cargo de quién**: un socio, varios
  con porcentaje, o común.
- Lo común se reparte con la regla del negocio: partes iguales, % fijo de
  cada socio, o en proporción a lo que vendió cada uno en el periodo.
- Se pregunta también **quién lo pagó**: el negocio o un socio de su bolsa.
  Si lo pagó un socio, se le abona como aportación.

### 1.5 Compras y anticipos

- Cada quien compra lo suyo. Si una compra se paga **con dinero del negocio**
  (cajón, banco), lo comprado cuenta como **anticipo** del dueño de esos
  productos: el negocio adelantó su dinero y se lo cobra cuando lo vende.
- Si la pagó **el socio de su bolsa**, no hay anticipo: al vender recupera su
  costo.
- Una compra a crédito cuenta solo lo ya pagado.

### 1.6 Caja

- El cajón es uno y el corte cuadra igual que siempre.
- Cada corte muestra cuánto de lo vendido le toca a cada socio.
- Faltante o sobrante de un corte: en proporción a lo vendido o en partes
  iguales.
- Un socio puede **retirar** del cajón: queda como salida de caja y como
  retiro suyo.

### 1.7 Liquidación

- Semanal (con día de cierre) o mensual.
- Por socio y periodo: costo recuperado, ganancia, gastos a su cargo,
  anticipos, aportaciones, retiros.
- **Saldo** = lo que le toca − lo que ya tomó. Positivo: el negocio le debe.
  Negativo: él le debe al negocio.
- La suma de los saldos de todos es el dinero del negocio que todavía no se ha
  repartido.
- Una liquidación cerrada no cambia. Pagar el saldo es un movimiento más.

### 1.8 Asistente de activación

Aplicaciones → Socios → Activar abre el asistente:

1. Socios: nombre y usuario de cada uno.
2. Qué es de quién: cada categoría a un socio (o compartida).
3. Productos sin dueño: a un socio o por partes iguales.
4. Reparto de la ganancia: A, B o C, con el ejemplo calculado con un producto
   real del negocio y el deslizador de C.
5. Gastos comunes: partes iguales, % fijo o por ventas.
6. Faltantes del corte: por ventas o partes iguales.
7. Liquidación: semanal (día) o mensual.
8. Desde cuándo se llevan las cuentas.

Todo se puede cambiar después; el cambio aplica desde ese momento.

## 2. Propinas

- Se cobran al pagar: botones de % sugeridos o cantidad libre, en efectivo o
  tarjeta.
- **No son venta**: no llevan IVA y no entran en la utilidad ni en el reparto
  de socios.
- La propina en efectivo entra al cajón (movimiento `TIP`). La de tarjeta
  llega al banco.
- **Reparto** al personal, configurable:
  - a quien atendió (el usuario que cobró);
  - bote del turno por horas trabajadas (Asistencia);
  - bote del turno en partes iguales entre quienes trabajaron.
- Pagar el reparto sale del cajón (movimiento `TIP_PAYOUT`), uno por persona.
- Comisión de tarjeta sobre la propina: la absorbe el negocio o se descuenta
  de la propina.
- En México la propina es del trabajador (LFT art. 346): nunca va a los
  socios. Un socio que trabaja el turno y checa entra como trabajador.

## 3. Pruebas

`npm run db:test-socios` corre el mismo escenario con 2, 3, 4… hasta 10
socios y comprueba en cada uno:

- que la suma de lo repartido de cada renglón es exactamente su ingreso;
- las reglas A, B y C con su ejemplo calculado a mano;
- combos, productos compartidos, sin dueño, devoluciones;
- gastos de un socio, divididos y comunes con cada regla;
- anticipos por compras con dinero del negocio y sin anticipo de su bolsa;
- que la suma de saldos es el dinero del negocio sin repartir;
- el límite de 10 socios y las validaciones;
- propinas: reparto por atendió, por horas y por partes iguales, con y sin
  comisión.
