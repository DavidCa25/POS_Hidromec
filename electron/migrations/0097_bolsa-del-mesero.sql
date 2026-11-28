/* ============================================================
   0097 — bolsa del mesero

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0097_bolsa-del-mesero.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0097_bolsa-del-mesero.sql ========== */
/* 0097 · La bolsa del mesero
 *
 * Cada mesero cobra sus mesas (o cualquier otra) desde su tablet. Lo que cobra
 * en efectivo, con la propina en efectivo, lo trae él: no está en el cajón
 * hasta que lo entrega. Al final del turno lo entrega en caja y Wybix dice si
 * le falta o le sobra.
 *
 *   mesero_cobros     cada mesa que cobró un mesero: su venta, cómo pagó, la
 *                     propina y el efectivo que quedó en su bolsa. El
 *                     movimiento MESERO_BOLSA (−) saca ese efectivo de lo que
 *                     espera el cajón.
 *   mesero_entregas   cada entrega del mesero en caja: lo que debía entregar,
 *                     lo que entregó y la diferencia. El movimiento
 *                     MESERO_ENTREGA (+) mete al cajón lo que entregó.
 *
 * La venta es una venta normal de la caja (sp_register_sale), a nombre del
 * mesero: inventario, IVA, reportes y propinas como siempre.
 */
/* Los dos movimientos nuevos del cajón, con su nombre para el corte. */
IF NOT EXISTS (SELECT 1 FROM dbo.cash_movement_types WHERE code = 'MESERO_BOLSA')
INSERT INTO dbo.cash_movement_types (code, label, grupo, sort_order) VALUES ('MESERO_BOLSA', N'Efectivo que traen los meseros', 'RETIROS', 76);

IF NOT EXISTS (SELECT 1 FROM dbo.cash_movement_types WHERE code = 'MESERO_ENTREGA')
INSERT INTO dbo.cash_movement_types (code, label, grupo, sort_order) VALUES ('MESERO_ENTREGA', N'Entrega de mesero', 'ENTRADAS', 56);

IF OBJECT_ID(N'dbo.mesero_cobros', 'U') IS NULL
BEGIN
CREATE TABLE dbo.mesero_cobros (
    sale_id INT NOT NULL,
    mesero_id INT NOT NULL,
    cuenta_id INT NULL,
    closure_id INT NOT NULL,
    register_id INT NOT NULL,
    metodo NVARCHAR(30) COLLATE Modern_Spanish_CI_AS NOT NULL,
    total DECIMAL(12, 2) NOT NULL,
    propina DECIMAL(12, 2) NOT NULL CONSTRAINT DF_mesero_cobros_propina DEFAULT ((0)),
    propina_metodo VARCHAR(12) COLLATE Modern_Spanish_CI_AS NULL,
    efectivo DECIMAL(12, 2) NOT NULL,
    cash_movement_id INT NULL,
    cobrado_en DATETIME2(3) NOT NULL CONSTRAINT DF_mesero_cobros_cobrado_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_mesero_cobros PRIMARY KEY CLUSTERED (sale_id)
);
END;

IF OBJECT_ID(N'dbo.FK_mesero_cobros_sale', 'F') IS NULL
ALTER TABLE dbo.mesero_cobros WITH CHECK ADD CONSTRAINT FK_mesero_cobros_sale FOREIGN KEY (sale_id) REFERENCES dbo.sales (id);

IF OBJECT_ID(N'dbo.FK_mesero_cobros_closure', 'F') IS NULL
ALTER TABLE dbo.mesero_cobros WITH CHECK ADD CONSTRAINT FK_mesero_cobros_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_mesero_cobros_mesero' AND object_id = OBJECT_ID(N'dbo.mesero_cobros'))
CREATE NONCLUSTERED INDEX IX_mesero_cobros_mesero ON dbo.mesero_cobros (mesero_id, closure_id);

IF OBJECT_ID(N'dbo.mesero_entregas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.mesero_entregas (
    id INT IDENTITY(1, 1) NOT NULL,
    mesero_id INT NOT NULL,
    closure_id INT NOT NULL,
    register_id INT NOT NULL,
    esperado DECIMAL(12, 2) NOT NULL,
    entregado DECIMAL(12, 2) NOT NULL,
    diferencia DECIMAL(12, 2) NOT NULL,
    recibio_user_id INT NULL,
    nota NVARCHAR(255) COLLATE Modern_Spanish_CI_AS NULL,
    cash_movement_id INT NULL,
    entregado_en DATETIME2(3) NOT NULL CONSTRAINT DF_mesero_entregas_en DEFAULT (sysdatetime()),
    CONSTRAINT PK_mesero_entregas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.FK_mesero_entregas_closure', 'F') IS NULL
ALTER TABLE dbo.mesero_entregas WITH CHECK ADD CONSTRAINT FK_mesero_entregas_closure FOREIGN KEY (closure_id) REFERENCES dbo.cash_closures (id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_mesero_entregas_mesero' AND object_id = OBJECT_ID(N'dbo.mesero_entregas'))
CREATE NONCLUSTERED INDEX IX_mesero_entregas_mesero ON dbo.mesero_entregas (mesero_id, closure_id);
GO

/* ---------- sp_mesero_cobro_registrar (SQL_STORED_PROCEDURE) ---------- */
/* sp_mesero_cobro_registrar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0097 · UNA MESA QUE COBRÓ UN MESERO, A SU BOLSA.

   Se llama justo después de registrar la venta (y su propina) que cobró el
   mesero desde su tablet, en la MISMA transacción. El efectivo que entró por
   esa venta (movimientos SALE y TIP de la venta: lo que de verdad cuenta el
   cajón, ya con pagos divididos) lo trae el mesero, no el cajón: sale con un
   MESERO_BOLSA (−) del mismo turno. Así el corte solo espera lo que el mesero
   ya entregó.

   Una vez por venta: llamarlo otra vez devuelve lo ya registrado. */
CREATE OR ALTER PROCEDURE dbo.sp_mesero_cobro_registrar
    @sale_id INT,
    @mesero_id INT,
    @cuenta_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.mesero_cobros WHERE sale_id = @sale_id)
    BEGIN
        DECLARE @register INT, @closure INT, @metodo NVARCHAR(30), @total DECIMAL(12, 2);
        SELECT @register = register_id, @closure = closure_id, @metodo = payment_method, @total = total
          FROM dbo.sales WHERE id = @sale_id;
        IF @register IS NULL THROW 51000, 'Esa venta no existe.', 1;
        IF @closure IS NULL
            SELECT TOP (1) @closure = id FROM dbo.cash_closures
             WHERE register_id = @register AND closed_at IS NULL ORDER BY opened_at DESC, id DESC;
        IF @closure IS NULL THROW 51000, 'No hay un turno abierto en la caja de esa venta.', 1;

        DECLARE @efectivo DECIMAL(12, 2) = ISNULL((SELECT SUM(amount) FROM dbo.cash_movements
                                                    WHERE reference_id = @sale_id AND typee IN ('SALE', 'TIP')), 0);
        DECLARE @propina DECIMAL(12, 2) = 0, @prop_metodo VARCHAR(12) = NULL;
        IF OBJECT_ID(N'dbo.propinas', 'U') IS NOT NULL
            SELECT @propina = ISNULL(monto, 0), @prop_metodo = metodo FROM dbo.propinas WHERE sale_id = @sale_id;

        DECLARE @mov INT = NULL;
        BEGIN TRAN;
            IF @efectivo > 0
            BEGIN
                INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
                VALUES (GETDATE(), @mesero_id, 'MESERO_BOLSA', @sale_id, CONCAT(N'MESERO VENTA ', @sale_id), -@efectivo,
                        N'Efectivo que cobró el mesero: lo trae él hasta entregarlo', @closure, @register);
                SET @mov = SCOPE_IDENTITY();
            END;
            INSERT INTO dbo.mesero_cobros (sale_id, mesero_id, cuenta_id, closure_id, register_id, metodo, total, propina, propina_metodo, efectivo, cash_movement_id)
            VALUES (@sale_id, @mesero_id, @cuenta_id, @closure, @register, @metodo, @total, @propina, @prop_metodo, @efectivo, @mov);
        COMMIT;
    END;

    SELECT sale_id, mesero_id, cuenta_id, closure_id, metodo, total, propina, propina_metodo, efectivo, cobrado_en
      FROM dbo.mesero_cobros WHERE sale_id = @sale_id;
END;
GO

/* ---------- sp_mesero_cuenta (SQL_STORED_PROCEDURE) ---------- */
/* sp_mesero_cuenta
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0097 · LA CUENTA QUE LLEVA UN MESERO EN EL TURNO.

   Lo que cobró en los turnos abiertos (o en @closure_id):

   1  resumen: mesas cobradas, total, por método, propinas (y cuánto de ellas
      en efectivo), efectivo que entró a su bolsa, lo que ya entregó, lo que
      le falta entregar y la diferencia de sus entregas (− le faltó).
   2  sus cobros, del más reciente al primero: hora, mesa, método, total y
      propina.
   3  sus entregas. */
CREATE OR ALTER PROCEDURE dbo.sp_mesero_cuenta
    @mesero_id INT,
    @closure_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.* INTO #c
      FROM dbo.mesero_cobros c
      JOIN dbo.cash_closures z ON z.id = c.closure_id
     WHERE c.mesero_id = @mesero_id
       AND ((@closure_id IS NULL AND z.closed_at IS NULL) OR c.closure_id = @closure_id);

    SELECT e.* INTO #e
      FROM dbo.mesero_entregas e
      JOIN dbo.cash_closures z ON z.id = e.closure_id
     WHERE e.mesero_id = @mesero_id
       AND ((@closure_id IS NULL AND z.closed_at IS NULL) OR e.closure_id = @closure_id);

    SELECT @mesero_id AS mesero_id,
           (SELECT usuario FROM dbo.users WHERE id = @mesero_id) AS usuario,
           (SELECT COUNT(*) FROM #c) AS mesas,
           CAST(ISNULL((SELECT SUM(total) FROM #c), 0) AS DECIMAL(12, 2)) AS cobrado,
           CAST(ISNULL((SELECT SUM(total) FROM #c WHERE metodo = 'EFECTIVO'), 0) AS DECIMAL(12, 2)) AS en_efectivo,
           CAST(ISNULL((SELECT SUM(total) FROM #c WHERE metodo = 'TARJETA'), 0) AS DECIMAL(12, 2)) AS con_tarjeta,
           CAST(ISNULL((SELECT SUM(total) FROM #c WHERE metodo = 'TRANSFERENCIA'), 0) AS DECIMAL(12, 2)) AS por_transferencia,
           CAST(ISNULL((SELECT SUM(total) FROM #c WHERE metodo NOT IN ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA')), 0) AS DECIMAL(12, 2)) AS otros,
           CAST(ISNULL((SELECT SUM(propina) FROM #c), 0) AS DECIMAL(12, 2)) AS propinas,
           CAST(ISNULL((SELECT SUM(propina) FROM #c WHERE propina_metodo = 'EFECTIVO'), 0) AS DECIMAL(12, 2)) AS propinas_efectivo,
           CAST(ISNULL((SELECT SUM(efectivo) FROM #c), 0) AS DECIMAL(12, 2)) AS en_bolsa,
           CAST(ISNULL((SELECT SUM(entregado) FROM #e), 0) AS DECIMAL(12, 2)) AS entregado,
           CAST(ISNULL((SELECT SUM(efectivo) FROM #c), 0) - ISNULL((SELECT SUM(esperado) FROM #e), 0) AS DECIMAL(12, 2)) AS por_entregar,
           CAST(ISNULL((SELECT SUM(diferencia) FROM #e), 0) AS DECIMAL(12, 2)) AS diferencia;

    SELECT c.sale_id, c.cuenta_id, c.cobrado_en, c.metodo, c.total, c.propina, c.propina_metodo, c.efectivo,
           COALESCE(m.nombre, h.etiqueta, CONCAT(N'Venta ', c.sale_id)) AS mesa
      FROM #c c
      LEFT JOIN dbo.hosp_cuentas h ON h.id = c.cuenta_id
      LEFT JOIN dbo.salon_mesas m ON m.id = h.mesa_id
     ORDER BY c.cobrado_en DESC;

    SELECT id, esperado, entregado, diferencia, entregado_en, nota FROM #e ORDER BY entregado_en DESC;
END;
GO

/* ---------- sp_mesero_entregar (SQL_STORED_PROCEDURE) ---------- */
/* sp_mesero_entregar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0097 · EL MESERO ENTREGA SU EFECTIVO EN CAJA.

   Lo que debía entregar es lo que entró a su bolsa en los turnos abiertos
   menos lo que ya se le tomó en entregas anteriores. Lo que entrega entra al
   cajón de @register_id (MESERO_ENTREGA +) en su turno abierto; la diferencia
   queda en la entrega (− le faltó, + le sobró) y NO en el corte de la caja:
   el cajón cuadra con lo que de verdad le dieron.

   Se puede entregar en partes (a media noche y al cerrar). */
CREATE OR ALTER PROCEDURE dbo.sp_mesero_entregar
    @mesero_id INT,
    @entregado DECIMAL(12, 2),
    @register_id INT,
    @user_id INT = NULL,
    @nota NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @entregado IS NULL OR @entregado < 0 THROW 51000, 'Lo entregado tiene que ser de $0 en adelante.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @mesero_id) THROW 51000, 'Ese mesero no existe.', 1;

    BEGIN TRAN;
        DECLARE @closure INT;
        SELECT TOP (1) @closure = id FROM dbo.cash_closures WITH (UPDLOCK, HOLDLOCK)
         WHERE register_id = @register_id AND closed_at IS NULL ORDER BY opened_at DESC, id DESC;
        IF @closure IS NULL THROW 51000, 'No hay un turno abierto en esta caja para recibir la entrega.', 1;

        DECLARE @esperado DECIMAL(12, 2) =
              ISNULL((SELECT SUM(c.efectivo) FROM dbo.mesero_cobros c WITH (UPDLOCK, HOLDLOCK)
                        JOIN dbo.cash_closures z ON z.id = c.closure_id
                       WHERE c.mesero_id = @mesero_id AND z.closed_at IS NULL), 0)
            - ISNULL((SELECT SUM(e.esperado) FROM dbo.mesero_entregas e WITH (UPDLOCK, HOLDLOCK)
                        JOIN dbo.cash_closures z ON z.id = e.closure_id
                       WHERE e.mesero_id = @mesero_id AND z.closed_at IS NULL), 0);
        IF @esperado <= 0 AND @entregado = 0 THROW 51000, 'Ese mesero no tiene efectivo por entregar.', 1;

        DECLARE @mov INT = NULL;
        IF @entregado > 0
        BEGIN
            INSERT INTO dbo.cash_movements (datee, userId, typee, reference_id, reference, amount, note, closure_id, register_id)
            VALUES (GETDATE(), ISNULL(@user_id, @mesero_id), 'MESERO_ENTREGA', @mesero_id,
                    CONCAT(N'ENTREGA MESERO ', (SELECT usuario FROM dbo.users WHERE id = @mesero_id)), @entregado,
                    LEFT(CONCAT(N'Entrega del mesero', CASE WHEN @nota IS NULL THEN N'' ELSE N' · ' + @nota END), 255), @closure, @register_id);
            SET @mov = SCOPE_IDENTITY();
        END;

        DECLARE @id INT;
        INSERT INTO dbo.mesero_entregas (mesero_id, closure_id, register_id, esperado, entregado, diferencia, recibio_user_id, nota, cash_movement_id)
        VALUES (@mesero_id, @closure, @register_id, CASE WHEN @esperado < 0 THEN 0 ELSE @esperado END, @entregado,
                @entregado - CASE WHEN @esperado < 0 THEN 0 ELSE @esperado END, @user_id, @nota, @mov);
        SET @id = SCOPE_IDENTITY();
    COMMIT;

    SELECT id, mesero_id, closure_id, esperado, entregado, diferencia, entregado_en FROM dbo.mesero_entregas WHERE id = @id;
END;
GO

/* ---------- sp_meseros_resumen (SQL_STORED_PROCEDURE) ---------- */
/* sp_meseros_resumen
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0097 · LOS MESEROS DEL TURNO, PARA LA CAJA.

   Cada mesero que cobró algo en los turnos abiertos: mesas, cobrado,
   propinas, efectivo en su bolsa, lo entregado, lo que le falta entregar y
   la diferencia de sus entregas. Lo usa la pantalla de entregas y el corte
   (para avisar quién no ha entregado antes de cerrar). */
CREATE OR ALTER PROCEDURE dbo.sp_meseros_resumen
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH c AS (
        SELECT c.mesero_id, COUNT(*) AS mesas, SUM(c.total) AS cobrado, SUM(c.propina) AS propinas, SUM(c.efectivo) AS en_bolsa
          FROM dbo.mesero_cobros c JOIN dbo.cash_closures z ON z.id = c.closure_id
         WHERE z.closed_at IS NULL
         GROUP BY c.mesero_id),
    e AS (
        SELECT e.mesero_id, SUM(e.esperado) AS esperado, SUM(e.entregado) AS entregado, SUM(e.diferencia) AS diferencia
          FROM dbo.mesero_entregas e JOIN dbo.cash_closures z ON z.id = e.closure_id
         WHERE z.closed_at IS NULL
         GROUP BY e.mesero_id)
    SELECT c.mesero_id, u.usuario, c.mesas,
           CAST(c.cobrado AS DECIMAL(12, 2)) AS cobrado,
           CAST(c.propinas AS DECIMAL(12, 2)) AS propinas,
           CAST(c.en_bolsa AS DECIMAL(12, 2)) AS en_bolsa,
           CAST(ISNULL(e.entregado, 0) AS DECIMAL(12, 2)) AS entregado,
           CAST(c.en_bolsa - ISNULL(e.esperado, 0) AS DECIMAL(12, 2)) AS por_entregar,
           CAST(ISNULL(e.diferencia, 0) AS DECIMAL(12, 2)) AS diferencia
      FROM c
      JOIN dbo.users u ON u.id = c.mesero_id
      LEFT JOIN e ON e.mesero_id = c.mesero_id
     ORDER BY CASE WHEN c.en_bolsa - ISNULL(e.esperado, 0) > 0 THEN 0 ELSE 1 END, u.usuario;
END;
GO
