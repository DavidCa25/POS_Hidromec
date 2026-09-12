/* sp_raffle_close
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_raffle_close — dejar de repartir boletos, sin sortear todavia.

   Cerrar y sortear son dos actos distintos. Cerrar dice "ya no entran mas
   participaciones" y congela el universo; sortear elige. Entre los dos
   pueden pasar semanas, y durante ese tiempo el numero de participantes no
   puede moverse, porque es el numero que se anuncio.

   QUE CONGELA
   -----------
   `closed_entries_count`  cuantos boletos validos habia al cerrar
   `closed_max_entry_id`   el ultimo boleto admitido
   `closed_at`             cuando se cerro

   `sp_raffle_draw` sortea SOBRE ESO, no sobre lo que haya en la tabla el dia
   que alguien pulse el boton.

   IDEMPOTENTE
   -----------
   Cerrar una rifa ya cerrada no vuelve a congelar nada: devuelve la foto que
   ya se tomo. Si recontara, dos pulsaciones separadas darian dos universos
   distintos, que es justo lo que este procedure existe para impedir.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_raffle_close]
    @raffle_id INT,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @estado NVARCHAR(10);

    BEGIN TRY
        BEGIN TRAN;

        /* UPDLOCK sobre la rifa: dos cajas pulsando "cerrar" a la vez deben
           producir UNA foto, no dos. La segunda espera y encuentra la rifa ya
           cerrada. */
        SELECT @estado = status
        FROM dbo.raffle_definitions WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @raffle_id;

        IF @estado IS NULL
        BEGIN
            IF XACT_STATE() <> 0 ROLLBACK TRAN;
            RAISERROR('La rifa no existe.', 16, 1);
            RETURN;
        END

        IF @estado = 'DRAFT'
        BEGIN
            IF XACT_STATE() <> 0 ROLLBACK TRAN;
            RAISERROR('Esta rifa todavia no se ha activado: no hay nada que cerrar.', 16, 1);
            RETURN;
        END

        IF @estado = 'DRAWN'
        BEGIN
            IF XACT_STATE() <> 0 ROLLBACK TRAN;
            RAISERROR('Esta rifa ya se sorteo.', 16, 1);
            RETURN;
        END

        /* Ya cerrada: no se recuenta. La foto es la que se tomo entonces. */
        IF @estado = 'OPEN'
        BEGIN
            UPDATE r
               SET status = 'CLOSED',
                   closed_at = SYSDATETIME(),   /* hora local: misma politica que sp_loyalty_evaluate_sale */
                   closed_entries_count = ISNULL(e.n, 0),
                   closed_max_entry_id = ISNULL(e.maxid, 0)
            FROM dbo.raffle_definitions r
            OUTER APPLY (
                SELECT COUNT(*) AS n, MAX(id) AS maxid
                FROM dbo.raffle_entries WITH (UPDLOCK, HOLDLOCK)
                WHERE raffle_id = @raffle_id AND status = 'VALID'
            ) e
            WHERE r.id = @raffle_id;
        END

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    SELECT id, name, status, closed_at, closed_entries_count, closed_max_entry_id, winners_count
    FROM dbo.raffle_definitions
    WHERE id = @raffle_id;
END
GO
