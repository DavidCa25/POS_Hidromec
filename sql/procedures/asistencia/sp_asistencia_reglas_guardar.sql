/* sp_asistencia_reglas_guardar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ================== sp_asistencia_reglas_guardar (0071) ==================
   Las respuestas de "Activar Asistencia", que son las reglas del negocio.

   @activar = 1 es la primera vez, desde Aplicaciones: guarda las reglas Y
   enciende el modulo en la MISMA transaccion. Una decision, una escritura:
   no puede quedar el modulo encendido sin reglas ni reglas de un modulo
   apagado. Con @activar = 0 solo cambia las reglas de un modulo encendido.

   La tolerancia es una pregunta de si y no: si = 10 minutos, no = 0.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_reglas_guardar
    @cuenta_extra        BIT,
    @tolerancia          BIT,
    @descanso_pagado     BIT,
    @dia_libre_extra     BIT,
    @marca_retardos      BIT,
    @entrada_para_vender BIT,
    @activar             BIT = 0,
    @user_id             INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @cuenta_extra IS NULL OR @tolerancia IS NULL OR @descanso_pagado IS NULL
       OR @dia_libre_extra IS NULL OR @marca_retardos IS NULL OR @entrada_para_vender IS NULL
        THROW 51000, N'Contesta todas las preguntas.', 1;

    IF ISNULL(@activar, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'asistencia' AND enabled = 1)
        THROW 51000, N'Asistencia no está activada.', 1;

    BEGIN TRAN;
        MERGE dbo.asistencia_reglas AS d
        USING (SELECT CAST(1 AS TINYINT) AS id) AS s ON d.id = s.id
        WHEN MATCHED THEN UPDATE SET
            cuenta_extra = @cuenta_extra,
            tolerancia_min = CASE WHEN @tolerancia = 1 THEN 10 ELSE 0 END,
            descanso_pagado = @descanso_pagado,
            dia_libre_extra = @dia_libre_extra,
            marca_retardos = @marca_retardos,
            entrada_para_vender = @entrada_para_vender,
            updated_at = SYSDATETIME(),
            updated_by = @user_id
        WHEN NOT MATCHED THEN INSERT
            (id, cuenta_extra, tolerancia_min, descanso_pagado, dia_libre_extra, marca_retardos,
             entrada_para_vender, updated_at, updated_by)
            VALUES (1, @cuenta_extra, CASE WHEN @tolerancia = 1 THEN 10 ELSE 0 END, @descanso_pagado,
                    @dia_libre_extra, @marca_retardos, @entrada_para_vender, SYSDATETIME(), @user_id);

        IF @activar = 1
        BEGIN
            DECLARE @r TABLE (module_key NVARCHAR(40), enabled BIT, enabled_at DATETIME2(0), enabled_by INT, updated_at DATETIME2(0));
            INSERT INTO @r EXEC dbo.sp_set_business_module @module_key = N'asistencia', @enabled = 1, @user_id = @user_id;
        END
    COMMIT;

    EXEC dbo.sp_asistencia_reglas_get;
END
GO
