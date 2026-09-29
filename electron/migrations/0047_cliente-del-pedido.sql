/* ==========================================================================
   0047 — EL CLIENTE DEL PEDIDO Y SU NOMBRE PUBLICO
   --------------------------------------------------------------------------
   Touch ya puede asignar un cliente a la venta (el mismo `cart.customer` de
   Venta, que termina en `sales.customer_id`). En Hospitality el pedido existe
   ANTES de la venta: se envia a cocina, se ve en el tablero de pedidos y se
   cobra despues. Por eso la cuenta necesita saber de quien es:

     · hosp_cuentas.customer_id   relacion con `customers`, la del modelo real
                                  de Wybix. No se copia el nombre a ninguna
                                  tabla: se lee de `customers` cuando hace
                                  falta. Mientras la cuenta esta abierta, la
                                  caja la mantiene igual que su carrito; al
                                  cobrar se alinea con la venta, que es la
                                  que manda (`sales.customer_id`).

   NOMBRE PUBLICO. El tablero de pedidos lo ve cualquiera en el local (TV) o
   en su telefono. Ahi el cliente se reconoce por su numero y, como ayuda,
   por un nombre CORTO: `dbo.fn_nombre_publico_cliente`. Se calcula en SQL,
   asi que el nombre completo ni siquiera sale de la base hacia la ruta
   publica. Reglas:
     · solo la primera palabra del nombre («David Casillas» -> «David»),
       recortada a 20 caracteres;
     · si esa palabra parece un dato de contacto (lleva @ o digitos), nada;
     · «Publico en general» y parecidos no son una persona: nada.
   Nunca telefono, correo, RFC, direccion ni datos fiscales.
   ========================================================================== */

IF COL_LENGTH(N'dbo.hosp_cuentas', N'customer_id') IS NULL
    ALTER TABLE dbo.hosp_cuentas ADD customer_id INT NULL
        CONSTRAINT FK_hosp_cuentas_customer REFERENCES dbo.customers(id);
GO

CREATE OR ALTER FUNCTION dbo.fn_nombre_publico_cliente (@nombre NVARCHAR(120))
RETURNS NVARCHAR(20)
AS
BEGIN
    DECLARE @n NVARCHAR(120) = LTRIM(RTRIM(REPLACE(REPLACE(ISNULL(@nombre, N''), NCHAR(9), N' '), NCHAR(160), N' ')));
    IF @n = N'' RETURN NULL;
    /* Quien no es una persona no tiene nombre publico. */
    IF @n LIKE N'P_blico%' OR @n LIKE N'Mostrador%' OR @n LIKE N'Cliente general%' RETURN NULL;
    DECLARE @espacio INT = CHARINDEX(N' ', @n);
    DECLARE @primero NVARCHAR(120) = CASE WHEN @espacio > 0 THEN LEFT(@n, @espacio - 1) ELSE @n END;
    /* Un correo o un telefono capturado como nombre no se publica. */
    IF @primero LIKE N'%@%' OR @primero LIKE N'%[0-9]%' RETURN NULL;
    RETURN LEFT(@primero, 20);
END
GO

/* ABRIR: igual que en 0046, mas el cliente opcional. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_abrir
    @mesa_id INT = NULL,
    @etiqueta NVARCHAR(60) = NULL,
    @personas INT = NULL,
    @user_id INT = NULL,
    @register_id INT = NULL,
    @customer_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @id INT, @numero INT = NULL, @ahora DATETIME2 = SYSDATETIME();

    IF @mesa_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.salon_mesas WHERE id = @mesa_id AND activa = 1)
    BEGIN RAISERROR('La mesa no existe.', 16, 1); RETURN; END

    IF @mesa_id IS NULL AND LTRIM(RTRIM(ISNULL(@etiqueta, ''))) = ''
    BEGIN RAISERROR('Una cuenta sin mesa necesita un nombre.', 16, 1); RETURN; END

    IF @customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN RAISERROR('El cliente no existe.', 16, 1); RETURN; END

    BEGIN TRAN;
    IF @mesa_id IS NOT NULL
        SELECT @id = id FROM dbo.hosp_cuentas WITH (UPDLOCK, HOLDLOCK)
         WHERE mesa_id = @mesa_id AND estado IN ('ABIERTA', 'POR_COBRAR');

    IF @id IS NULL
    BEGIN
        IF @mesa_id IS NULL
            SELECT @numero = ISNULL(MAX(numero_dia), 0) + 1
              FROM dbo.hosp_cuentas WITH (UPDLOCK, HOLDLOCK)
             WHERE abierta_dia = CAST(@ahora AS DATE);

        INSERT INTO dbo.hosp_cuentas (mesa_id, etiqueta, personas, abierta_por, register_id, abierta_en, numero_dia, seguimiento, customer_id)
        VALUES (@mesa_id, NULLIF(LTRIM(RTRIM(@etiqueta)), ''), @personas, @user_id, @register_id, @ahora, @numero,
                CASE WHEN @numero IS NOT NULL THEN CONVERT(CHAR(32), CRYPT_GEN_RANDOM(16), 2) END, @customer_id);
        SET @id = SCOPE_IDENTITY();
    END
    /* Una mesa ya abierta toma el cliente solo si aun no tenia: abrirla desde
       otra caja no cambia de quien es. */
    ELSE IF @customer_id IS NOT NULL
        UPDATE dbo.hosp_cuentas SET customer_id = @customer_id WHERE id = @id AND customer_id IS NULL;
    COMMIT TRAN;

    EXEC dbo.sp_hosp_cuenta_get @cuenta_id = @id;
END
GO

/* ASIGNAR, CAMBIAR o QUITAR (@customer_id NULL) el cliente de una cuenta
   abierta. Lo llama la caja cuando cambia el cliente de su carrito. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_cliente
    @cuenta_id INT,
    @customer_id INT = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.hosp_cuentas WHERE id = @cuenta_id AND estado IN ('ABIERTA', 'POR_COBRAR'))
    BEGIN RAISERROR('Esta cuenta ya está cerrada.', 16, 1); RETURN; END
    IF @customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.customers WHERE id = @customer_id)
    BEGIN RAISERROR('El cliente no existe.', 16, 1); RETURN; END
    UPDATE dbo.hosp_cuentas SET customer_id = @customer_id WHERE id = @cuenta_id;
    SELECT c.id, c.customer_id, cu.customerName AS customer_name
      FROM dbo.hosp_cuentas c
      LEFT JOIN dbo.customers cu ON cu.id = c.customer_id
     WHERE c.id = @cuenta_id;
END
GO

/* COBRADA: igual que en 0040, y el cliente de la cuenta queda el de la venta
   (la venta es la que manda; la caja ya los tenia iguales). */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_cobrar
    @cuenta_id INT,
    @sale_id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @estado NVARCHAR(12), @actual INT;
    SELECT @estado = estado, @actual = sale_id FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
    IF @estado IS NULL BEGIN RAISERROR('La cuenta no existe.', 16, 1); RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.sales WHERE id = @sale_id)
    BEGIN RAISERROR('La venta no existe.', 16, 1); RETURN; END

    IF @estado = 'COBRADA'
    BEGIN
        IF @actual = @sale_id
        BEGIN SELECT id, estado, sale_id FROM dbo.hosp_cuentas WHERE id = @cuenta_id; RETURN; END
        RAISERROR('Esta cuenta ya se cobró con otra venta.', 16, 1); RETURN;
    END
    IF @estado = 'CANCELADA' BEGIN RAISERROR('Esta cuenta se canceló.', 16, 1); RETURN; END

    UPDATE c
       SET estado = 'COBRADA', sale_id = @sale_id, cerrada_por = @user_id, cerrada_en = SYSDATETIME(),
           customer_id = s.customer_id
      FROM dbo.hosp_cuentas c
      JOIN dbo.sales s ON s.id = @sale_id
     WHERE c.id = @cuenta_id;

    SELECT id, estado, sale_id FROM dbo.hosp_cuentas WHERE id = @cuenta_id;
END
GO

/* Igual que en 0046, mas el cliente. Esto lo lee la CAJA (privada): lleva el
   nombre completo, que es el que el cajero reconoce. Nunca el codigo de
   seguimiento. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_cuenta_get
    @cuenta_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.id, c.mesa_id, m.nombre AS mesa, a.nombre AS area,
           COALESCE(m.nombre,
                    CASE WHEN c.numero_dia IS NOT NULL
                         THEN CONCAT(N'Pedido ', c.numero_dia, CASE WHEN c.etiqueta IS NOT NULL THEN N' · ' + c.etiqueta END) END,
                    c.etiqueta) AS titulo,
           c.etiqueta, c.numero_dia, c.estado, c.personas, c.abierta_en, c.abierta_por, c.cerrada_en, c.sale_id,
           c.customer_id, cu.customerName AS customer_name,
           DATEDIFF(MINUTE, c.abierta_en, SYSDATETIME()) AS minutos
      FROM dbo.hosp_cuentas c
      LEFT JOIN dbo.salon_mesas m ON m.id = c.mesa_id
      LEFT JOIN dbo.salon_areas a ON a.id = m.area_id
      LEFT JOIN dbo.customers cu ON cu.id = c.customer_id
     WHERE c.id = @cuenta_id;

    SELECT l.id, l.orden_id, l.product_id, l.nombre, l.cantidad, l.precio_unitario, l.nota,
           l.station_id, s.nombre AS estacion, l.comanda_id, k.estado AS comanda_estado, l.estado,
           l.origen, o.enviada_en,
           p.inventory_mode, p.clave_prod_serv, p.clave_unidad, p.objeto_impuesto, p.tasa_iva
      FROM dbo.hosp_orden_lineas l
      JOIN dbo.hosp_ordenes o ON o.id = l.orden_id
      JOIN dbo.products p ON p.id = l.product_id
      LEFT JOIN dbo.prep_stations s ON s.id = l.station_id
      LEFT JOIN dbo.comandas k ON k.id = l.comanda_id
     WHERE l.cuenta_id = @cuenta_id
     ORDER BY l.orden_id, l.id;

    SELECT x.linea_id, x.modifier_option_id, x.group_id, x.group_name, x.option_name, x.price_delta, x.quantity
      FROM dbo.hosp_orden_linea_opciones x
      JOIN dbo.hosp_orden_lineas l ON l.id = x.linea_id
     WHERE l.cuenta_id = @cuenta_id
     ORDER BY x.linea_id, x.id;

    SELECT k.id, k.orden_id, k.station_id, s.nombre AS estacion, k.estado, k.creada_en, k.lista_en, k.entregada_en
      FROM dbo.comandas k
      JOIN dbo.prep_stations s ON s.id = k.station_id
     WHERE k.cuenta_id = @cuenta_id
     ORDER BY k.id;
END
GO

/* Que productos de una lista van a preparacion: los que tienen una estacion
   ACTIVA. Es la MISMA regla con la que `sp_hosp_orden_enviar` crea comandas;
   la caja la usa para no dejar cobrar en silencio algo que la cocina nunca
   recibio. Un producto sin estacion (una botella de agua) no cuenta. */
CREATE OR ALTER PROCEDURE dbo.sp_hosp_productos_con_preparacion
    @ids NVARCHAR(2000)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @x XML = CAST(N'<i>' + REPLACE(ISNULL(@ids, N''), N',', N'</i><i>') + N'</i>' AS XML);
    SELECT DISTINCT pp.product_id
      FROM (SELECT TRY_CAST(t.v.value('.', 'NVARCHAR(12)') AS INT) AS id FROM @x.nodes('/i') t(v)) x
      JOIN dbo.product_prep_station pp ON pp.product_id = x.id
      JOIN dbo.prep_stations st ON st.id = pp.station_id AND st.activa = 1;
END
GO
