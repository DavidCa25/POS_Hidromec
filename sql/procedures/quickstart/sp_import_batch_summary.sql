/* sp_import_batch_summary
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   EL RESUMEN, QUE AHORA DICE LA VERDAD DE UNA CARGA A MEDIAS
   ------------------------------------------------------------
   En QA se importaron 9 de 10 y la pantalla seguia ofreciendo «Importar 9»
   sobre filas que ya estaban dentro. El CTA se calculaba con el total de
   filas listas, sin mirar cuales ya se habian aplicado.

   Ahora el resumen separa lo que queda POR hacer de lo que YA se hizo, y la
   pantalla no tiene que deducirlo.
   ============================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_summary
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT * FROM dbo.import_batches WHERE id = @batch_id;

    SELECT
        /* Lo que queda por entrar: aplicada = 0. Es de donde sale el boton. */
        SUM(CASE WHEN accion = 'CREATE' AND aplicada = 0 THEN 1 ELSE 0 END) AS crear,
        SUM(CASE WHEN accion = 'UPDATE' AND aplicada = 0 THEN 1 ELSE 0 END) AS actualizar,
        SUM(CASE WHEN accion = 'UNCHANGED' THEN 1 ELSE 0 END) AS igual,
        SUM(CASE WHEN accion = 'CONFLICT'  THEN 1 ELSE 0 END) AS conflicto,
        SUM(CASE WHEN accion = 'PENDIENTE' THEN 1 ELSE 0 END) AS pendiente,
        SUM(CASE WHEN accion = 'OMITIR'    THEN 1 ELSE 0 END) AS omitir,
        SUM(CASE WHEN aplicada = 1         THEN 1 ELSE 0 END) AS aplicadas,
        COUNT(*) AS total
    FROM dbo.import_rows WHERE batch_id = @batch_id;

    SELECT codigo, COUNT(*) AS cuantos
    FROM dbo.import_rows r
    CROSS APPLY OPENJSON(ISNULL(r.problemas_json, '[]'))
         WITH (codigo NVARCHAR(40) '$.codigo') j
    WHERE r.batch_id = @batch_id AND r.aplicada = 0
    GROUP BY codigo
    ORDER BY cuantos DESC;

    /* Que tipos trae esta carga. Decide las columnas de la revision: una
       hoja de ingredientes no se mira con las mismas que una de menu. */
    SELECT tipo, COUNT(*) AS cuantos
    FROM dbo.import_rows WHERE batch_id = @batch_id
    GROUP BY tipo ORDER BY cuantos DESC;
END
GO
