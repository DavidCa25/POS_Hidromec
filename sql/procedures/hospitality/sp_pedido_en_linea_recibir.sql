/* sp_pedido_en_linea_recibir
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · Llega un pedido de la nube. Idempotente por uuid: bajarlo dos veces
   no lo duplica. Solo guarda la SOLICITUD; no abre cuenta, no cobra, no toca
   inventario. Devuelve id y si es nuevo (para avisar en la caja). */
CREATE OR ALTER PROCEDURE dbo.sp_pedido_en_linea_recibir
    @uuid UNIQUEIDENTIFIER,
    @origen NVARCHAR(12) = NULL,
    @cliente_nombre NVARCHAR(60),
    @cliente_telefono NVARCHAR(20),
    @nota NVARCHAR(200) = NULL,
    @lineas NVARCHAR(MAX),
    @total_cliente DECIMAL(12, 2),
    @creado_en_nube DATETIME2(0) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @uuid IS NULL BEGIN RAISERROR('Falta el pedido.', 16, 1); RETURN; END
    IF ISJSON(@lineas) <> 1 OR NOT EXISTS (SELECT 1 FROM OPENJSON(@lineas))
    BEGIN RAISERROR('El pedido no trae productos.', 16, 1); RETURN; END
    IF LTRIM(RTRIM(ISNULL(@cliente_nombre, ''))) = '' OR LTRIM(RTRIM(ISNULL(@cliente_telefono, ''))) = ''
    BEGIN RAISERROR('El pedido no trae nombre o teléfono.', 16, 1); RETURN; END

    DECLARE @id INT, @nuevo BIT = 0;
    BEGIN TRAN;
    SELECT @id = id FROM dbo.pedidos_en_linea WITH (UPDLOCK, HOLDLOCK) WHERE uuid = @uuid;
    IF @id IS NULL
    BEGIN
        INSERT INTO dbo.pedidos_en_linea (uuid, origen, cliente_nombre, cliente_telefono, nota, lineas, total_cliente, creado_en_nube)
        VALUES (@uuid, UPPER(NULLIF(LTRIM(RTRIM(@origen)), '')), LTRIM(RTRIM(@cliente_nombre)), LTRIM(RTRIM(@cliente_telefono)),
                NULLIF(LTRIM(RTRIM(@nota)), ''), @lineas, @total_cliente, @creado_en_nube);
        SET @id = SCOPE_IDENTITY();
        SET @nuevo = 1;
    END
    COMMIT TRAN;
    SELECT @id AS id, @nuevo AS nuevo;
END
GO
