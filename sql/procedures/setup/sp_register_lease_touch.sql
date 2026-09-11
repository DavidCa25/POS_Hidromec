/* sp_register_lease_touch
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_register_lease_touch — el unico sitio donde se toma una caja.

   Reclamar, renovar y recuperar son la MISMA operacion: "este equipo sigue
   siendo esta caja, cuentalo desde ahora". Separarlas en tres procedimientos
   habria dado tres implementaciones de la misma carrera, y la carrera es
   justo lo unico dificil de esto.

   POR QUE UN SELECT CON UPDLOCK Y NO UN "UPDATE ... WHERE"
   -------------------------------------------------------
   Un UPDATE condicional tambien seria atomico, pero no dejaria decir QUIEN
   tiene la caja cuando se pierde la carrera, y ese dato es la mitad del valor
   para quien esta parado frente a la pantalla. Con UPDLOCK, HOLDLOCK sobre la
   clave primaria, dos equipos que reclaman C1 a la vez se serializan: el
   segundo espera, y cuando entra LEE el estado que dejo el primero. Uno gana,
   el otro se entera de por que perdio.

   EL RELOJ ES EL DEL SERVIDOR
   ---------------------------
   SYSUTCDATETIME() se lee UNA vez y se usa para todo. Con la hora del cliente
   bastaria adelantar el reloj local para robar una caja viva.

   RESULTADO
   ---------
     RECLAMADA   estaba libre (nunca tomada, liberada o caducada) y es mia
     RENOVADA    ya era mia y seguia viva
     RECUPERADA  era mia, habia caducado, y nadie la tomo entre medias
     OCUPADA     la tiene otro equipo, con arriendo vigente. No se toca nada.
     SIN_CAJA    ese register_id no existe

   Idempotente: llamarlo mil veces seguidas deja exactamente el mismo estado.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_register_lease_touch]
    @register_id   INT,
    @machine_id    NVARCHAR(64),
    @machine_name  NVARCHAR(120) = NULL,
    @lease_seconds INT = 300,
    @resultado     NVARCHAR(20)  OUTPUT,
    @holder_id     NVARCHAR(64)  OUTPUT,
    @holder_name   NVARCHAR(120) OUTPUT,
    @lease_until   DATETIME2(0)  OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @resultado  = NULL;
    SET @holder_id  = NULL;
    SET @holder_name = NULL;
    SET @lease_until = NULL;

    SET @machine_id = LTRIM(RTRIM(ISNULL(@machine_id, N'')));
    IF @machine_id = N''
    BEGIN
        RAISERROR('Falta la identidad del equipo para tomar la caja.', 16, 1);
        RETURN;
    END

    /* Un arriendo de 5 segundos convertiria cualquier microcorte en una caja
       perdida; uno de un dia devuelve el problema que se queria evitar. */
    SET @lease_seconds = CASE
        WHEN ISNULL(@lease_seconds, 0) < 30   THEN 30
        WHEN @lease_seconds > 3600            THEN 3600
        ELSE @lease_seconds END;

    IF NOT EXISTS (SELECT 1 FROM dbo.registers WHERE id = @register_id)
    BEGIN
        SET @resultado = N'SIN_CAJA';
        RETURN;
    END

    DECLARE @now DATETIME2(0) = SYSUTCDATETIME();
    DECLARE @hasta DATETIME2(0) = DATEADD(SECOND, @lease_seconds, @now);

    /* La fila tiene que existir para que reclamar sea un UPDATE puro. Nace
       LIBRE (released_at = ahora) y con un machine_id que ningun equipo real
       puede tener. Si dos equipos la crean a la vez, uno choca contra la clave
       primaria: eso no es un fallo, es que el otro ya hizo el trabajo. */
    IF NOT EXISTS (SELECT 1 FROM dbo.register_assignments WHERE register_id = @register_id)
    BEGIN
        /* XACT_ABORT se apaga SOLO aqui a proposito: con el encendido, una
           violacion de clave primaria condena la transaccion entera en vez de
           dejarse atrapar, y lo que aqui se quiere es exactamente lo
           contrario: que el choque sea inofensivo. */
        SET XACT_ABORT OFF;
        BEGIN TRY
            INSERT INTO dbo.register_assignments
                (register_id, machine_id, machine_name, claimed_at, heartbeat_at, lease_until, released_at, released_by)
            VALUES (@register_id, N'', NULL, @now, @now, @now, @now, N'INICIAL');
        END TRY
        BEGIN CATCH
            IF ERROR_NUMBER() NOT IN (2601, 2627) THROW;
        END CATCH
        SET XACT_ABORT ON;
    END

    DECLARE @cur_machine NVARCHAR(64), @cur_name NVARCHAR(120);
    DECLARE @cur_until DATETIME2(0), @cur_released DATETIME2(0);

    BEGIN TRAN;

        SELECT @cur_machine  = machine_id,
               @cur_name     = machine_name,
               @cur_until    = lease_until,
               @cur_released = released_at
        FROM dbo.register_assignments WITH (UPDLOCK, HOLDLOCK)
        WHERE register_id = @register_id;

        DECLARE @era_mia  BIT = CASE WHEN @cur_machine = @machine_id THEN 1 ELSE 0 END;
        DECLARE @vigente  BIT = CASE WHEN @cur_released IS NULL AND @cur_until > @now THEN 1 ELSE 0 END;

        IF (@vigente = 1 AND @era_mia = 0)
        BEGIN
            SET @resultado   = N'OCUPADA';
            SET @holder_id   = @cur_machine;
            SET @holder_name = @cur_name;
            SET @lease_until = @cur_until;
        END
        ELSE
        BEGIN
            UPDATE dbo.register_assignments
               SET machine_id   = @machine_id,
                   machine_name = ISNULL(NULLIF(LTRIM(RTRIM(@machine_name)), N''), machine_name),
                   heartbeat_at = @now,
                   lease_until  = @hasta,
                   released_at  = NULL,
                   released_by  = NULL,
                   /* `claimed_at` marca desde cuando este equipo es esta caja
                      SIN interrupcion. Un latido no lo mueve; recuperarla tras
                      una caida si, porque hubo un hueco. */
                   claimed_at   = CASE WHEN @era_mia = 1 AND @vigente = 1 THEN claimed_at ELSE @now END
             WHERE register_id = @register_id;

            SET @resultado = CASE
                WHEN @era_mia = 1 AND @vigente = 1 THEN N'RENOVADA'
                WHEN @era_mia = 1                  THEN N'RECUPERADA'
                ELSE N'RECLAMADA' END;
            SET @holder_id   = @machine_id;
            SET @holder_name = @machine_name;
            SET @lease_until = @hasta;
        END

    COMMIT TRAN;
END
GO
