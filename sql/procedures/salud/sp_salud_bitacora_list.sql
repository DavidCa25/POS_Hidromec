/* sp_salud_bitacora_list
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Quién hizo qué con el expediente de un paciente, más reciente primero.
 * @registrar: anota una acción hecha fuera de SQL (IMPRIMIR, EXPORTAR)
 * antes de listar, para no necesitar otro viaje.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_salud_bitacora_list]
    @customer_id  INT,
    @registrar    NVARCHAR(20) = NULL,
    @documento_id INT = NULL,
    @user_id      INT = NULL,
    @top          INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    IF @top IS NULL OR @top NOT BETWEEN 1 AND 1000 SET @top = 100;
    SET @registrar = NULLIF(UPPER(LTRIM(RTRIM(@registrar))), N'');
    IF @registrar IS NOT NULL
    BEGIN
        IF @registrar NOT IN (N'IMPRIMIR', N'EXPORTAR')
        BEGIN RAISERROR('Acción de bitácora inválida.', 16, 1); RETURN; END
        INSERT INTO dbo.salud_bitacora (user_id, paciente_id, documento_id, accion)
        VALUES (@user_id, @customer_id, @documento_id, @registrar);
    END

    SELECT TOP (@top) b.id, b.accion, b.documento_id, b.at, u.usuario
      FROM dbo.salud_bitacora b
      LEFT JOIN dbo.users u ON u.id = b.user_id
     WHERE b.paciente_id = @customer_id
     ORDER BY b.at DESC, b.id DESC;
END
GO
