/* sp_staff_publication
 * Definicion canonica. No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_staff_publication ======================
   0052. Las personas de ESTA sucursal que pueden trabajar en un evento:
   activas y con PIN personal vigente.

   Viaja el HASH del PIN (scrypt N=16384 r=8 p=1, 32 bytes) y su sal, nunca
   el PIN ni la contrasena: la tablet tiene que identificar a la persona sin
   Internet y no puede preguntarle a nadie. El rol de SUCURSAL viaja como
   referencia; el rol que vale en el evento lo asigna el dueno por ubicacion
   (ser encargado aqui no da permisos en la feria).
   ================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_staff_publication
AS
BEGIN
    SET NOCOUNT ON;
    SELECT JSON_QUERY(ISNULL((
        SELECT LOWER(CONVERT(VARCHAR(36), u.uuid)) AS uuid,
               u.usuario AS name,
               LOWER(LTRIM(RTRIM(u.rol))) AS branch_role,
               a.pin_hash,
               a.pin_sal,
               'scrypt:16384:8:1:32' AS pin_algo,
               CONVERT(VARCHAR(19), a.pin_creado_en, 126) AS pin_set_at
          FROM dbo.users u
          JOIN dbo.trabajadores_acceso a ON a.user_id = u.id
         WHERE u.active = 1 AND a.pin_hash IS NOT NULL AND a.revocado_en IS NULL
         ORDER BY u.id
           FOR JSON PATH), '[]')) AS staff_json;
END
GO
