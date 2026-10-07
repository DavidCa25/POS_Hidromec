/* sp_commercial_policy_save
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE dbo.sp_commercial_policy_save @actor_id INT, @expected_version INT, @payload NVARCHAR(MAX)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF ISJSON(@payload)<>1 THROW 51000,'Configuración inválida.',1;
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM dbo.commercial_policy WITH(UPDLOCK,HOLDLOCK) WHERE id=1 AND version=@expected_version)
 BEGIN ROLLBACK; THROW 51000,'CONFLICTO_DE_VERSION: recarga antes de guardar.',1; END;
 UPDATE dbo.commercial_policy SET version=version+1,payload=JSON_MODIFY(@payload,'$.version',version+1),updated_by=@actor_id,updated_at=SYSUTCDATETIME() WHERE id=1;
 COMMIT;
 SELECT version,payload FROM dbo.commercial_policy WHERE id=1;
END;
GO
