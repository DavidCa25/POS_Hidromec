/* sp_pedido_en_linea_publicado
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · La nube ya sabe este estado: no se vuelve a mandar. */
CREATE OR ALTER PROCEDURE dbo.sp_pedido_en_linea_publicado
    @uuid UNIQUEIDENTIFIER,
    @estado NVARCHAR(12)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.pedidos_en_linea SET estado_publicado = @estado, publicado_en = SYSDATETIME() WHERE uuid = @uuid;
    SELECT @@ROWCOUNT AS n;
END
GO
