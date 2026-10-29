/* sp_asistencia_corregir
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ==================== sp_asistencia_corregir (0071) ====================
   Un encargado corrige una jornada (la salida que se olvido, una entrada mal
   marcada) o registra una que no se marco (@jornada_id NULL).

   Reglas:
     · motivo obligatorio, y queda en asistencia_correcciones con lo que
       habia antes y quien lo cambio;
     · nadie corrige sus propias horas;
     · la jornada no puede pasar de 24 horas ni encimarse con otra de la
       misma persona;
     · con salida queda CERRADA. Sin salida solo se puede corregir la
       entrada de una jornada que sigue ABIERTA.
   El permiso (ASISTENCIA_GESTIONAR) lo exige el proceso principal.
   ==================================================================== */
CREATE OR ALTER PROCEDURE dbo.sp_asistencia_corregir
    @jornada_id INT = NULL,
    @persona_id INT = NULL,
    @entrada    DATETIME2(0),
    @salida     DATETIME2(0) = NULL,
    @motivo     NVARCHAR(255),
    @user_id    INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = N'asistencia' AND enabled = 1)
        THROW 51000, N'Asistencia no está activada.', 1;
    SET @motivo = NULLIF(LTRIM(RTRIM(@motivo)), N'');
    IF @motivo IS NULL OR LEN(@motivo) < 3
        THROW 51000, N'Escribe el motivo de la corrección.', 1;
    IF @user_id IS NULL
        THROW 51000, N'Falta quién corrige.', 1;
    IF @entrada IS NULL
        THROW 51000, N'Indica la hora de entrada.', 1;

    DECLARE @estado VARCHAR(12), @e_antes DATETIME2(0), @s_antes DATETIME2(0);

    BEGIN TRAN;
        IF @jornada_id IS NOT NULL
        BEGIN
            SELECT @persona_id = user_id, @estado = estado, @e_antes = entrada_en, @s_antes = salida_en
              FROM dbo.asistencia_jornadas WITH (UPDLOCK, HOLDLOCK) WHERE id = @jornada_id;
            IF @estado IS NULL THROW 51000, N'Esa jornada no existe.', 1;
        END
        ELSE IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE id = @persona_id)
            THROW 51000, N'Esa persona no existe.', 1;

        IF @persona_id = @user_id
            THROW 51000, N'Nadie corrige sus propias horas: pídeselo a un encargado.', 1;
        IF @salida IS NULL AND (@jornada_id IS NULL OR @estado <> 'ABIERTA')
            THROW 51000, N'Indica la hora de salida.', 1;
        IF @salida IS NOT NULL AND @salida <= @entrada
            THROW 51000, N'La salida tiene que ser después de la entrada.', 1;
        IF DATEDIFF(MINUTE, @entrada, ISNULL(@salida, SYSDATETIME())) > 24 * 60
            THROW 51000, N'Una jornada no puede pasar de 24 horas.', 1;
        IF @entrada > SYSDATETIME() OR @salida > SYSDATETIME()
            THROW 51000, N'No se pueden registrar horas en el futuro.', 1;
        IF EXISTS (SELECT 1 FROM dbo.asistencia_jornadas o
                    WHERE o.user_id = @persona_id AND (@jornada_id IS NULL OR o.id <> @jornada_id)
                      AND o.estado <> 'SIN_SALIDA'
                      AND o.entrada_en < ISNULL(@salida, SYSDATETIME())
                      AND ISNULL(o.salida_en, SYSDATETIME()) > @entrada)
            THROW 51000, N'Se encima con otra jornada de esa persona.', 1;

        IF @jornada_id IS NULL
        BEGIN
            INSERT INTO dbo.asistencia_jornadas (user_id, dia, entrada_en, salida_en, estado, corregida)
            VALUES (@persona_id, CAST(@entrada AS DATE), @entrada, @salida, 'CERRADA', 1);
            SET @jornada_id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.asistencia_jornadas
               SET entrada_en = @entrada, dia = CAST(@entrada AS DATE), salida_en = @salida,
                   estado = CASE WHEN @salida IS NULL THEN estado ELSE 'CERRADA' END,
                   corregida = 1
             WHERE id = @jornada_id;

        /* Un descanso que quedo abierto se cierra con la jornada. */
        IF @salida IS NOT NULL
            UPDATE dbo.asistencia_descansos
               SET fin_en = CASE WHEN inicio_en > @salida THEN inicio_en ELSE @salida END
             WHERE jornada_id = @jornada_id AND fin_en IS NULL;

        INSERT INTO dbo.asistencia_correcciones
            (jornada_id, entrada_antes, salida_antes, entrada_nueva, salida_nueva, motivo, corregida_por)
        VALUES (@jornada_id, @e_antes, @s_antes, @entrada, @salida, @motivo, @user_id);
    COMMIT;

    SELECT @jornada_id AS jornada_id;
END
GO
