/* sp_register_claim
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_register_claim — "esta maquina es esta caja".

   Lo llama la app en tres momentos que son el mismo: al elegir la caja en
   Configuracion, al arrancar (reclamando la que quedo guardada) y cada minuto
   mientras esta abierta. Envuelve a `sp_register_lease_touch` y devuelve algo
   que la pantalla pueda mostrar tal cual.

   EL MENSAJE VIAJA COMO DATO, NO COMO ERROR
   -----------------------------------------
   Perder la carrera no es una excepcion: es una respuesta. Y ademas el
   controlador `msnodesqlv8` degrada el TEXTO de los errores a un byte por
   caracter -los acentos llegan como U+FFFD- mientras que las filas de datos
   conservan el juego de caracteres. Un nombre de equipo con acento solo
   sobrevive por el canal de datos.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_claim]
    @register_id   INT,
    @machine_id    NVARCHAR(64),
    @machine_name  NVARCHAR(120) = NULL,
    @lease_seconds INT = 300
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @resultado NVARCHAR(20), @holder_id NVARCHAR(64),
            @holder_name NVARCHAR(120), @hasta DATETIME2(0);

    EXEC dbo.sp_register_lease_touch
        @register_id   = @register_id,
        @machine_id    = @machine_id,
        @machine_name  = @machine_name,
        @lease_seconds = @lease_seconds,
        @resultado     = @resultado OUTPUT,
        @holder_id     = @holder_id OUTPUT,
        @holder_name   = @holder_name OUTPUT,
        @lease_until   = @hasta OUTPUT;

    DECLARE @quien NVARCHAR(120) = ISNULL(NULLIF(LTRIM(RTRIM(@holder_name)), N''), N'otro equipo');

    SELECT
        CASE WHEN @resultado IN (N'RECLAMADA', N'RENOVADA', N'RECUPERADA') THEN 1 ELSE 0 END AS ok,
        @resultado                AS resultado,
        @register_id              AS register_id,
        (SELECT name FROM dbo.registers WHERE id = @register_id) AS register_name,
        @holder_id                AS holder_machine_id,
        @holder_name              AS holder_machine_name,
        @hasta                    AS lease_until,
        CASE WHEN @hasta IS NULL THEN NULL
             ELSE DATEDIFF(SECOND, SYSUTCDATETIME(), @hasta) END AS segundos_restantes,
        CASE @resultado
            WHEN N'OCUPADA'  THEN CONCAT(N'Esta caja la está usando ', @quien,
                                         N'. Libérala en ese equipo, o elige otra caja.')
            WHEN N'SIN_CAJA' THEN N'Esa caja ya no existe en el catálogo.'
            ELSE NULL
        END AS mensaje;
END
GO
