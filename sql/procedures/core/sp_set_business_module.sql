/* sp_set_business_module
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Enciende o apaga un modulo, y deja constancia de quien lo hizo.
 *
 * APAGAR NO DESTRUYE NADA. Solo cambia este BIT: las tablas del modulo, sus
 * datos y su historial se quedan donde estan. Volver a encenderlo devuelve
 * todo al estado en que quedo.
 *
 * DUAL-WRITE durante la ventana de compatibilidad: mientras existan cajas que
 * leen las columnas antiguas de `business_config`, este procedimiento escribe
 * tambien alli. Se retira cuando ninguna version soportada dependa de ellas,
 * no en una fecha.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_set_business_module]
    @module_key NVARCHAR(40),
    @enabled    BIT,
    @user_id    INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF LTRIM(RTRIM(ISNULL(@module_key, ''))) = ''
    BEGIN
        RAISERROR('Falta el identificador del modulo.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    MERGE dbo.business_modules AS d
    USING (SELECT @module_key AS module_key) AS s
       ON d.module_key = s.module_key
     WHEN MATCHED THEN
          UPDATE SET enabled = @enabled,
                     enabled_at = CASE WHEN @enabled = 1 AND d.enabled = 0 THEN SYSDATETIME()
                                       ELSE d.enabled_at END,
                     enabled_by = CASE WHEN @enabled = 1 THEN ISNULL(@user_id, d.enabled_by)
                                       ELSE d.enabled_by END,
                     updated_at = SYSDATETIME()
     WHEN NOT MATCHED THEN
          INSERT (module_key, enabled, enabled_at, enabled_by, updated_at)
          VALUES (@module_key, @enabled,
                  CASE WHEN @enabled = 1 THEN SYSDATETIME() END,
                  CASE WHEN @enabled = 1 THEN @user_id END,
                  SYSDATETIME());

    /* Espejo hacia las columnas antiguas, mientras hagan falta. */
    IF @module_key = 'loyalty'
        UPDATE dbo.business_config SET loyalty_enabled = @enabled;

    IF @module_key = 'hospitality'
        UPDATE dbo.business_config
           SET business_profile = CASE WHEN @enabled = 1 THEN 'HOSPITALITY' ELSE 'RETAIL' END;

    COMMIT;

    SELECT module_key, enabled, enabled_at, enabled_by, updated_at
      FROM dbo.business_modules WHERE module_key = @module_key;
END
GO
