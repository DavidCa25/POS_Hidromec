/* sp_register_release
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_register_release — soltar la caja.

   DOS CAMINOS, Y LA DIFERENCIA IMPORTA
   ------------------------------------
   EQUIPO  Wybix se cierra limpiamente y suelta SU caja. Solo puede soltar la
           suya: por eso se exige @machine_id y se compara. Sin esto, un
           equipo podria echar a otro sin que nadie lo autorice.

   ADMIN   alguien con permiso libera una caja desde Configuracion porque el
           equipo que la tenia ya no existe -robado, reinstalado, muerto- y
           no quiere esperar a que caduque el arriendo. Es la escotilla, y se
           registra como tal en `released_by`.

   Sin la escotilla, cambiar de equipo obligaria a esperar; sin la
   comprobacion de @machine_id, la escotilla estaria abierta para todos. Las
   dos cosas a la vez, no una.

   Idempotente: liberar algo ya libre devuelve 'YA_LIBRE' y no es un error.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_release]
    @register_id  INT,
    @machine_id   NVARCHAR(64) = NULL,
    @por          NVARCHAR(20) = N'EQUIPO'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @por = UPPER(LTRIM(RTRIM(ISNULL(@por, N'EQUIPO'))));
    IF @por NOT IN (N'EQUIPO', N'ADMIN')
    BEGIN
        RAISERROR('Origen de liberacion invalido: EQUIPO o ADMIN.', 16, 1);
        RETURN;
    END

    SET @machine_id = LTRIM(RTRIM(ISNULL(@machine_id, N'')));
    IF @por = N'EQUIPO' AND @machine_id = N''
    BEGIN
        RAISERROR('Falta la identidad del equipo para soltar la caja.', 16, 1);
        RETURN;
    END

    DECLARE @now DATETIME2(0) = SYSUTCDATETIME();
    DECLARE @resultado NVARCHAR(20) = N'YA_LIBRE';
    DECLARE @cur_machine NVARCHAR(64), @cur_name NVARCHAR(120);

    BEGIN TRAN;

        SELECT @cur_machine = machine_id, @cur_name = machine_name
        FROM dbo.register_assignments WITH (UPDLOCK, HOLDLOCK)
        WHERE register_id = @register_id
          AND released_at IS NULL
          AND lease_until > @now;

        IF @cur_machine IS NOT NULL
        BEGIN
            IF @por = N'ADMIN' OR @cur_machine = @machine_id
            BEGIN
                UPDATE dbo.register_assignments
                   SET released_at = @now,
                       released_by = @por,
                       heartbeat_at = @now
                 WHERE register_id = @register_id;
                SET @resultado = CASE WHEN @por = N'ADMIN' THEN N'LIBERADA_ADMIN' ELSE N'LIBERADA' END;
            END
            ELSE
                SET @resultado = N'NO_ES_TUYA';
        END

    COMMIT TRAN;

    SELECT
        CASE WHEN @resultado IN (N'LIBERADA', N'LIBERADA_ADMIN', N'YA_LIBRE') THEN 1 ELSE 0 END AS ok,
        @resultado   AS resultado,
        @register_id AS register_id,
        @cur_name    AS holder_machine_name,
        CASE WHEN @resultado = N'NO_ES_TUYA'
             THEN CONCAT(N'Esa caja la tiene ', ISNULL(NULLIF(@cur_name, N''), N'otro equipo'),
                         N'. Solo ese equipo puede soltarla, o un administrador puede liberarla.')
             ELSE NULL END AS mensaje;
END
GO
