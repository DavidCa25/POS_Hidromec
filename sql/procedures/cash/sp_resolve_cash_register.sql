/* sp_resolve_cash_register
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ------------------------------------------------------------------------
   ¿DE QUE CAJA ES ESTA OPERACION DE DINERO?

   Una sola respuesta para todas las operaciones que tocan el cajon (retiro,
   abono, devolucion, ajuste de venta, pago a proveedor, egreso). Antes cada
   procedure decidia por su cuenta, y dos lo hacian mal:

     · `SELECT TOP 1 id FROM registers ORDER BY id` -> "la Caja 1". En
       MultiCaja, el dinero de la Caja 2 acababa en el corte de la Caja 1.
     · `WHERE userId = @user_id` -> el turno de quien lo ABRIO. Si devolvia
       otra persona, "no hay turno abierto"; si esa persona tenia turno en otra
       caja, el dinero caia ahi.

   ORDEN (gana el primero que responda):
     1. la caja que dice quien llama (debe existir);
     2. la que este equipo tiene arrendada (register_assignments);
     3. la del unico turno abierto que tenga este usuario (compatibilidad con
        versiones de la app que no mandan ni caja ni equipo);
     4. la unica caja activa del negocio (MonoCaja).
   Si nada de eso responde, @resolved queda NULL y QUIEN LLAMA decide: una
   operacion en efectivo debe fallar con un mensaje claro, nunca adivinar.

   MULTICAJA: si el equipo se identifica (@machine_id), la caja debe ser SUYA.
   Es el mismo contrato que abrir turno, cerrar y vender (sp_register_lease_
   touch): sin identidad no se exige nada, con identidad se valida y renueva
   el arriendo.
   ------------------------------------------------------------------------ */
CREATE OR ALTER PROCEDURE dbo.sp_resolve_cash_register
    @register_id  INT = NULL,
    @machine_id   NVARCHAR(64) = NULL,
    @machine_name NVARCHAR(120) = NULL,
    @user_id      INT = NULL,
    @resolved     INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @resolved = NULL;
    SET @machine_id = NULLIF(LTRIM(RTRIM(ISNULL(@machine_id, N''))), N'');

    /* 1) La que dice quien llama. Una caja que no existe es un error: seguir
          con otra seria mover dinero a un corte que nadie pidio. */
    IF @register_id IS NOT NULL
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = @register_id)
        BEGIN
            RAISERROR('La caja indicada no existe.', 16, 1);
            RETURN;
        END
        SET @resolved = @register_id;
    END

    /* 2) La de este equipo. */
    IF @resolved IS NULL AND @machine_id IS NOT NULL
        SELECT @resolved = a.register_id
          FROM dbo.register_assignments a
         WHERE a.machine_id = @machine_id
           AND a.released_at IS NULL
           AND a.lease_until > SYSUTCDATETIME();

    /* 3) El unico turno abierto de esta persona. Si tiene dos (o ninguno), no
          se elige: eso es justo el error que se esta corrigiendo. */
    IF @resolved IS NULL AND @user_id IS NOT NULL
        AND (SELECT COUNT(*) FROM dbo.cash_closures WHERE userId = @user_id AND closed_at IS NULL) = 1
        SELECT @resolved = register_id
          FROM dbo.cash_closures
         WHERE userId = @user_id AND closed_at IS NULL;

    /* 4) Un negocio con una sola caja no tiene nada que decidir. */
    IF @resolved IS NULL AND (SELECT COUNT(*) FROM dbo.registers WHERE is_active = 1) = 1
        SELECT @resolved = id FROM dbo.registers WHERE is_active = 1;

    /* MultiCaja: la caja resuelta tiene que ser de este equipo. */
    IF @resolved IS NOT NULL AND @machine_id IS NOT NULL
    BEGIN
        DECLARE @lease_res NVARCHAR(20), @lease_holder NVARCHAR(64),
                @lease_holder_name NVARCHAR(120), @lease_hasta DATETIME2(0);
        EXEC dbo.sp_register_lease_touch
            @register_id   = @resolved,
            @machine_id    = @machine_id,
            @machine_name  = @machine_name,
            @lease_seconds = 300,
            @resultado     = @lease_res OUTPUT,
            @holder_id     = @lease_holder OUTPUT,
            @holder_name   = @lease_holder_name OUTPUT,
            @lease_until   = @lease_hasta OUTPUT;
        IF @lease_res = N'OCUPADA'
        BEGIN
            /* Sin acentos: el texto de un error de SQL Server llega al cliente
               degradado a un byte por caracter. */
            DECLARE @quien NVARCHAR(120) = ISNULL(NULLIF(LTRIM(RTRIM(@lease_holder_name)), N''), N'otro equipo');
            SET @resolved = NULL;
            RAISERROR('Esta caja la esta usando %s. El dinero de cada caja va a su propio corte.', 16, 1, @quien);
            RETURN;
        END
    END
END
GO
