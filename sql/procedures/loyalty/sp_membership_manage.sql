SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_membership_manage (0063) =====================
   Las dos acciones a mano de Fidelización > Club:

     @accion = 'CANCELAR'  da de baja una membresía (no devuelve dinero: eso
                           es una devolución de la venta). Deja de dar el
                           beneficio desde ya.
     @accion = 'REVISAR'   marca un canje doble como revisado, con su nota.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_membership_manage
    @accion  VARCHAR(10),
    @id      INT,
    @user_id INT,
    @nota    NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @accion = 'CANCELAR'
    BEGIN
        UPDATE dbo.customer_memberships
           SET status = N'CANCELLED', cancelled_at = SYSDATETIME(), cancelled_by = @user_id, updated_at = SYSDATETIME()
         WHERE id = @id AND status <> N'CANCELLED';
        IF @@ROWCOUNT = 0 THROW 51000, 'Esa membresia no existe o ya estaba cancelada.', 1;
    END
    ELSE IF @accion = 'REVISAR'
    BEGIN
        UPDATE dbo.membership_redemptions
           SET reviewed_at = SYSDATETIME(), reviewed_by = @user_id, review_note = NULLIF(LTRIM(RTRIM(@nota)), N'')
         WHERE id = @id AND doble = 1 AND reviewed_at IS NULL;
        IF @@ROWCOUNT = 0 THROW 51000, 'Ese canje no esta pendiente de revision.', 1;
    END
    ELSE THROW 51000, 'Accion no valida.', 1;
    SELECT @id AS id;
END;
GO
