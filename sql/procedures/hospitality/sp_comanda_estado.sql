/* sp_comanda_estado
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* El flujo es hacia delante: NUEVA -> PREPARANDO -> LISTA -> ENTREGADA.
   Saltarse PREPARANDO se permite (un vaso de agua de la barra), volver atras
   no: una comanda entregada que vuelve a «nueva» haria cocinar dos veces. */
CREATE OR ALTER PROCEDURE dbo.sp_comanda_estado
    @comanda_id INT,
    @estado NVARCHAR(12),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @actual NVARCHAR(12);
    SET @estado = UPPER(LTRIM(RTRIM(ISNULL(@estado, ''))));
    SELECT @actual = estado FROM dbo.comandas WHERE id = @comanda_id;
    IF @actual IS NULL BEGIN RAISERROR('La comanda no existe.', 16, 1); RETURN; END

    DECLARE @paso INT = CASE @actual WHEN 'NUEVA' THEN 0 WHEN 'PREPARANDO' THEN 1 WHEN 'LISTA' THEN 2
                                     WHEN 'ENTREGADA' THEN 3 ELSE 9 END;
    DECLARE @destino INT = CASE @estado WHEN 'PREPARANDO' THEN 1 WHEN 'LISTA' THEN 2 WHEN 'ENTREGADA' THEN 3 ELSE -1 END;
    IF @destino < 0 BEGIN RAISERROR('Estado no válido.', 16, 1); RETURN; END
    IF @paso = 9 BEGIN RAISERROR('Esta comanda se canceló.', 16, 1); RETURN; END
    IF @destino <= @paso BEGIN RAISERROR('La comanda ya pasó por ese paso.', 16, 1); RETURN; END

    UPDATE dbo.comandas
       SET estado = @estado,
           empezada_en = CASE WHEN @destino >= 1 THEN ISNULL(empezada_en, SYSDATETIME()) ELSE empezada_en END,
           lista_en = CASE WHEN @destino >= 2 THEN ISNULL(lista_en, SYSDATETIME()) ELSE lista_en END,
           entregada_en = CASE WHEN @destino = 3 THEN SYSDATETIME() ELSE entregada_en END
     WHERE id = @comanda_id;

    SELECT id, estado, empezada_en, lista_en, entregada_en FROM dbo.comandas WHERE id = @comanda_id;
END
GO
