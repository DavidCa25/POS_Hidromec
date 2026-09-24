/* sp_bump_security_revision
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Invalida las sesiones abiertas de TODAS las cajas.
 *
 * Se llama cuando cambia algo que altera lo que alguien puede hacer: su rol o
 * su estado activo. Las sesiones no se cierran: la proxima accion sensible
 * recalcula permisos contra la base.
 *
 * Es un contador global y no uno por usuario a proposito. Un cambio de
 * permisos ocurre unas pocas veces al ano en un negocio pequeno, y que
 * recalculen todas las sesiones cuesta una consulta diminuta por maquina.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_bump_security_revision]
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.database_metadata WHERE clave = 'security_revision')
        INSERT INTO dbo.database_metadata (clave, valor) VALUES ('security_revision', '1');

    UPDATE dbo.database_metadata
       SET valor = CONVERT(NVARCHAR(255), CONVERT(INT, valor) + 1),
           actualizado_en = SYSDATETIME()
     WHERE clave = 'security_revision';

    SELECT CONVERT(INT, valor) AS security_revision
      FROM dbo.database_metadata WHERE clave = 'security_revision';
END
GO
