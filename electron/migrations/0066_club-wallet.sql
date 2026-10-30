/* ============================================================
   0066 — club wallet

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0066_club-wallet.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0066_club-wallet.sql ========== */
/* ============================================================
   0066 — Tarjeta del Club en Wallet (esquema)

   club_wallet_passes   Los pases de Apple Wallet / Google Wallet que la
                        nube emitió para clientes de esta empresa. El
                        código del pase dice `WXC-<serial>`: con esta tabla
                        la caja sabe de quién es SIN internet. Llegan al
                        emitir uno aquí y por club_pull (`wallet_passes`),
                        los emitidos en otras sucursales.

                        phone_key = últimos 10 dígitos del teléfono, la
                        misma llave con la que el Club reconoce al cliente.

   Aditiva: nada existente cambia de significado.
   ============================================================ */

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.club_wallet_passes', N'U') IS NULL
    CREATE TABLE dbo.club_wallet_passes (
        serial          CHAR(24)      NOT NULL,
        phone_key       VARCHAR(10)   NOT NULL,
        customer_name   NVARCHAR(120) COLLATE Modern_Spanish_CI_AS NULL,
        created_at      DATETIME2(0)  NOT NULL CONSTRAINT DF_club_wallet_passes_created DEFAULT SYSDATETIME(),
        CONSTRAINT PK_club_wallet_passes PRIMARY KEY (serial),
        CONSTRAINT CK_club_wallet_passes_serial CHECK (serial NOT LIKE '%[^0-9a-f]%'),
        CONSTRAINT CK_club_wallet_passes_phone CHECK (LEN(phone_key) = 10 AND phone_key NOT LIKE '%[^0-9]%')
    );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_club_wallet_passes_phone' AND object_id = OBJECT_ID(N'dbo.club_wallet_passes'))
    CREATE NONCLUSTERED INDEX IX_club_wallet_passes_phone ON dbo.club_wallet_passes (phone_key);
GO

/* ---------- sp_club_wallet_apply (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_club_wallet_apply (0066) =====================
   Pases de Wallet que esta caja debe reconocer: el que acaba de emitir y
   los que bajan de la nube (club_pull.wallet_passes).

   @payload = [{ serial, phone, customer_name }]

   Idempotente: un pase se reconoce por su serial; el teléfono no cambia
   (la nube da un pase por teléfono) y el nombre solo se completa.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_club_wallet_apply
    @payload NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISJSON(@payload) <> 1 THROW 51000, N'Pases inválidos.', 1;

    ;WITH j AS (
        SELECT LOWER(LTRIM(RTRIM(x.serial))) AS serial,
               RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(x.phone, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) AS tel,
               NULLIF(LTRIM(RTRIM(x.customer_name)), N'') AS customer_name
          FROM OPENJSON(@payload) WITH (serial NVARCHAR(40), phone NVARCHAR(40), customer_name NVARCHAR(120)) x
    )
    MERGE dbo.club_wallet_passes AS t
    USING (SELECT serial, MIN(tel) AS tel, MIN(customer_name) AS customer_name FROM j
            WHERE LEN(serial) = 24 AND serial NOT LIKE '%[^0-9a-f]%' AND LEN(tel) = 10 AND tel NOT LIKE '%[^0-9]%'
            GROUP BY serial) s
       ON t.serial = s.serial
     WHEN MATCHED AND t.customer_name IS NULL AND s.customer_name IS NOT NULL THEN UPDATE SET customer_name = s.customer_name
     WHEN NOT MATCHED THEN INSERT (serial, phone_key, customer_name) VALUES (s.serial, s.tel, s.customer_name);

    SELECT COUNT(*) AS pases FROM dbo.club_wallet_passes;
END
GO

/* ---------- sp_club_wallet_customer (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_club_wallet_customer (0066) =====================
   Lo que la nube necesita para emitir la tarjeta de un cliente: su nombre,
   su teléfono normalizado (últimos 10 dígitos de mobile o phone) y, si ya
   tiene, el serial de su pase.

   Devuelve una fila: { customer_id, customer_name, phone_key, serial }
   phone_key NULL = el cliente no tiene un teléfono de 10 dígitos.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_club_wallet_customer
    @customer_id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.id AS customer_id, c.customerName AS customer_name,
           CASE WHEN LEN(t.tel) = 10 AND t.tel NOT LIKE '%[^0-9]%' THEN t.tel END AS phone_key,
           (SELECT TOP 1 w.serial FROM dbo.club_wallet_passes w WHERE w.phone_key = t.tel ORDER BY w.created_at) AS serial
      FROM dbo.customers c
     CROSS APPLY (SELECT RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(NULLIF(c.mobile, N''), ISNULL(c.phone, N'')), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) AS tel) t
     WHERE c.id = @customer_id;
END
GO

/* ---------- sp_club_wallet_resolve (SQL_STORED_PROCEDURE) ---------- */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_club_wallet_resolve (0066) =====================
   La caja leyó el código de un pase (`WXC-<serial>`): ¿qué cliente es?

   Por su teléfono (últimos 10 dígitos de mobile o phone), igual que el Club
   y los puntos reconocen al cliente. Si el pase se emitió en otra sucursal
   y aquí no existe ese cliente, se da de alta con su nombre y teléfono -como
   hacen sp_membership_apply_remote y sp_loyalty_points_apply_remote-.

   Devuelve una fila: { customer_id, serial, phone_key, customer_name, pase }
     pase = 0 -> el serial no está en esta caja (la IPC pregunta a la nube).
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_club_wallet_resolve
    @serial VARCHAR(40)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @s CHAR(24) = LOWER(LTRIM(RTRIM(@serial))), @tel VARCHAR(10), @nombre NVARCHAR(120), @cliente INT;
    SELECT @tel = phone_key, @nombre = customer_name FROM dbo.club_wallet_passes WHERE serial = @s;
    IF @tel IS NULL
    BEGIN
        SELECT CAST(NULL AS INT) AS customer_id, @s AS serial, CAST(NULL AS VARCHAR(10)) AS phone_key, CAST(NULL AS NVARCHAR(120)) AS customer_name, CAST(0 AS BIT) AS pase;
        RETURN;
    END

    SELECT TOP 1 @cliente = id FROM dbo.customers
     WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(NULLIF(mobile, N''), ISNULL(phone, N'')), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) = @tel
     ORDER BY active DESC, id;

    IF @cliente IS NULL AND @nombre IS NOT NULL
    BEGIN
        INSERT INTO dbo.customers (customerName, phone, active) VALUES (@nombre, @tel, 1);
        SET @cliente = SCOPE_IDENTITY();
    END

    SELECT @cliente AS customer_id, @s AS serial, @tel AS phone_key,
           ISNULL((SELECT customerName FROM dbo.customers WHERE id = @cliente), @nombre) AS customer_name, CAST(1 AS BIT) AS pase;
END
GO
