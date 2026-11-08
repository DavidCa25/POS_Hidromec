/* sp_empresas_grupo
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ========================= sp_empresas_grupo (0080) =======================
   Esta empresa: su base, su nombre y el grupo al que pertenece (NULL si a
   ninguno). Segundo recordset: las bases del grupo en este servidor.
   docs/multiempresa.md.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_empresas_grupo
AS
BEGIN
    SET NOCOUNT ON;

    SELECT DB_NAME() AS base,
           (SELECT TOP (1) business_name    FROM dbo.business_config ORDER BY id) AS nombre,
           (SELECT TOP (1) business_profile FROM dbo.business_config ORDER BY id) AS giro,
           TRY_CONVERT(UNIQUEIDENTIFIER,
               (SELECT valor FROM dbo.database_metadata WHERE clave = N'empresas_grupo')) AS grupo,
           TRY_CONVERT(UNIQUEIDENTIFIER,
               (SELECT valor FROM dbo.database_metadata WHERE clave = N'instance_uuid')) AS instance_uuid;

    /* Las bases del grupo que esta base conoce (ella incluida si tiene grupo). */
    SELECT base FROM dbo.empresas_grupo_bases ORDER BY base;
END;
GO
