/* ============================================================
   0023 — cronometro exacto a la centesima

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   NO toca tablas ni datos. Solo objetos programables.
   ============================================================ */

/* ---------- sp_dynamic_play (SQL_STORED_PROCEDURE) ---------- */
/* sp_dynamic_play
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_dynamic_play — la pantalla reporta, SQL decide.

   LA REGLA QUE NO SE NEGOCIA
   --------------------------
   El Customer Display NO decide premios. Manda lo que ocurrio -"el cliente
   pulso a los 10.014 segundos"- y AQUI se decide si eso es WIN.

   Un `if (winner) generarCupon()` en el renderer seria literalmente un boton
   para fabricar premios: la pantalla del cliente corre en una ventana que
   cualquiera con la consola abierta puede tocar. Por eso el veredicto, el
   premio y la persistencia viven en la base, y la pantalla solo sabe su
   token.

   QUE SE VALIDA ANTES DE DECIDIR
   ------------------------------
     - el token existe;
     - el intento sigue PENDIENTE (no se juega dos veces);
     - no ha caducado;
     - la dinamica sigue activa.

   TIMING: gana si |pulsacion - objetivo| <= tolerancia. El resto de tipos
   -WHEEL, PICK_ONE, SCRATCH, RANDOM_REVEAL- comparten la misma forma, asi que
   entran aqui sin tocar ninguna tabla; hoy solo TIMING tiene pantalla.

   El premio se emite EN LA MISMA transaccion que marca el intento como
   jugado: no puede quedar un intento gastado sin premio, ni un premio sin
   intento.
   ============================================================ */
CREATE OR ALTER PROCEDURE [dbo].[sp_dynamic_play]
    @token NVARCHAR(32),
    @input_value DECIMAL(12,4),
    @machine_id NVARCHAR(64) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();   /* Hora local del negocio: misma politica que sp_loyalty_evaluate_sale. */
    DECLARE @id INT, @def INT, @tipo NVARCHAR(20), @estado NVARCHAR(12),
            @expira DATETIME2(0), @objetivo DECIMAL(12,4), @tolerancia DECIMAL(12,4),
            @rewardDef INT, @campaign INT, @customer INT, @sale INT, @register INT,
            @activa BIT;

    SELECT @id = a.id, @def = a.definition_id, @estado = a.status, @expira = a.expires_at,
           @campaign = a.campaign_id, @customer = a.customer_id, @sale = a.sale_id,
           @register = a.register_id,
           @tipo = d.type, @objetivo = d.target_value, @tolerancia = d.tolerance,
           @rewardDef = d.reward_definition_id, @activa = d.active
    FROM dbo.dynamic_attempts a
    JOIN dbo.dynamic_definitions d ON d.id = a.definition_id
    WHERE a.token = @token;

    IF @id IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'NO_EXISTE' AS motivo,
               CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS premio,
               N'Esta participación ya no es válida.' AS mensaje;
        RETURN;
    END

    IF @estado <> 'PENDING'
    BEGIN
        /* Jugar dos veces con el mismo token es el intento de abuso mas obvio
           que existe, y tiene que responderse igual siempre. */
        SELECT CAST(0 AS BIT) AS ok, N'YA_JUGADO' AS motivo,
               CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS premio,
               N'Esta participación ya se jugó.' AS mensaje;
        RETURN;
    END

    IF @expira IS NOT NULL AND @expira < @ahora
    BEGIN
        UPDATE dbo.dynamic_attempts SET status = 'EXPIRED' WHERE id = @id;
        SELECT CAST(0 AS BIT) AS ok, N'CADUCADO' AS motivo,
               CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS premio,
               N'Esta participación caducó.' AS mensaje;
        RETURN;
    END

    IF @activa = 0
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'INACTIVA' AS motivo,
               CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
               CAST(NULL AS NVARCHAR(120)) AS premio,
               N'Esta dinámica ya no está activa.' AS mensaje;
        RETURN;
    END

    /* ------------------------------------------------------- EL VEREDICTO */
    DECLARE @resultado NVARCHAR(8) = 'LOSE';

    IF @tipo = 'TIMING'
        /* EXACTO, a la centesima que el cliente VE.
           -----------------------------------------
           El juego es "detenlo en 10.00", no "detenlo cerca de 10". El margen
           configurable se retiro: un negocio no deberia tener que decidir una
           tolerancia, y un cliente que lee 10.00 en la pantalla y pierde no
           entenderia por que.

           La comparacion es en CENTESIMAS ENTERAS, la misma unidad con la que
           se pinta el cronometro. La pantalla manda el valor ya cuantizado a
           dos decimales -lo que muestra-, y aqui se multiplica por 100 en
           DECIMAL, que es aritmetica exacta: 9.99 -> 999, 10.00 -> 1000.

           Comparar los segundos en coma flotante seria pedir problemas: en el
           renderer 9.995 * 100 da 999.4999999999999, asi que lo mostrado y lo
           juzgado podrian discrepar. La regla es la MISMA a los dos lados
           porque a los dos lados se mira el mismo entero.

           `tolerance` queda sin uso para TIMING. No se borra la columna: hay
           dinamicas guardadas con ella y romper su definicion no aporta nada.
           Ver la nota de sp_loyalty_save_definition. */
        SET @resultado = CASE WHEN ROUND(@input_value * 100, 0) = ROUND(ISNULL(@objetivo, -1) * 100, 0)
                              THEN 'WIN' ELSE 'LOSE' END;
    ELSE IF @tipo IN ('WHEEL', 'PICK_ONE', 'RANDOM_REVEAL')
        /* El sector/opcion premiado es `target_value`. La pantalla dice cual
           salio; comparar es cosa de aqui. */
        SET @resultado = CASE WHEN @input_value = ISNULL(@objetivo, -1) THEN 'WIN' ELSE 'LOSE' END;
    ELSE IF @tipo = 'SCRATCH'
        /* La probabilidad la decide el servidor, nunca la pantalla: si el
           azar viviera en el renderer, bastaria con repetirlo hasta ganar. */
        SET @resultado = CASE WHEN (ABS(CHECKSUM(NEWID())) % 10000) < (ISNULL(@objetivo, 0) * 100)
                              THEN 'WIN' ELSE 'LOSE' END;

    DECLARE @codigo NVARCHAR(24) = NULL, @premio NVARCHAR(120) = NULL, @rewardId INT = NULL;

    BEGIN TRY
        BEGIN TRAN;

        /* El intento se marca jugado con una condicion: solo si SIGUE
           pendiente. Dos pulsaciones simultaneas -doble clic, dos ventanas-
           no pueden producir dos premios. */
        UPDATE dbo.dynamic_attempts
           SET status = 'PLAYED', input_value = @input_value, result = @resultado,
               played_at = @ahora,
               machine_id = ISNULL(@machine_id, machine_id)
         WHERE id = @id AND status = 'PENDING';

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRAN;
            SELECT CAST(0 AS BIT) AS ok, N'YA_JUGADO' AS motivo,
                   CAST(NULL AS NVARCHAR(8)) AS resultado, CAST(NULL AS NVARCHAR(24)) AS codigo,
                   CAST(NULL AS NVARCHAR(120)) AS premio,
                   N'Esta participación ya se jugó.' AS mensaje;
            RETURN;
        END

        IF @resultado = 'WIN' AND @rewardDef IS NOT NULL
        BEGIN
            INSERT INTO dbo.reward_instances
                (definition_id, campaign_id, customer_id, code, sale_id, register_id, machine_id,
                 status, uses_allowed, issued_at, expires_at)
            SELECT rd.id, @campaign, @customer,
                   LEFT(REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''), 24),
                   @sale, @register, @machine_id,
                   'ISSUED', rd.uses_allowed, @ahora,
                   CASE WHEN rd.valid_days IS NULL THEN NULL ELSE DATEADD(DAY, rd.valid_days, @ahora) END
            FROM dbo.reward_definitions rd
            WHERE rd.id = @rewardDef AND rd.active = 1;

            SET @rewardId = SCOPE_IDENTITY();
            IF @rewardId IS NOT NULL
            BEGIN
                SET @codigo = CONCAT('RW-', RIGHT(CONCAT('00000', CAST(@rewardId AS NVARCHAR(20))), 6));
                UPDATE dbo.reward_instances SET code = @codigo WHERE id = @rewardId;
                UPDATE dbo.dynamic_attempts SET reward_instance_id = @rewardId WHERE id = @id;
                SELECT @premio = name FROM dbo.reward_definitions WHERE id = @rewardDef;
            END
        END

        COMMIT TRAN;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(400) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
        RETURN;
    END CATCH

    SELECT CAST(1 AS BIT) AS ok, NULL AS motivo, @resultado AS resultado, @codigo AS codigo,
           @premio AS premio,
           CASE WHEN @resultado = 'WIN' AND @premio IS NOT NULL
                    THEN CONCAT(N'¡Ganaste! ', @premio)
                WHEN @resultado = 'WIN' THEN N'¡Ganaste!'
                ELSE N'Esta vez no fue. ¡Gracias por participar!' END AS mensaje;
END
GO

/* ---------- sp_loyalty_save_definition (SQL_STORED_PROCEDURE) ---------- */
/* sp_loyalty_save_definition
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ---- Crear o actualizar una DEFINICION de recompensa, cupon o dinamica.
   Un solo procedimiento para los tres porque el alta es la misma operacion
   -nombre, tipo, parametros, activo- y separarla en tres habria triplicado la
   misma validacion. `@kind_of` dice de cual se trata.

   Cada tipo exige lo suyo ANTES de guardar: una recompensa de importe sin
   importe, o una dinamica TIMING sin objetivo, se guardarian y fallarian mas
   tarde, cuando ya hay un cliente delante de la pantalla. */
CREATE OR ALTER PROCEDURE [dbo].[sp_loyalty_save_definition]
    @kind_of NVARCHAR(10),              -- REWARD | COUPON | DYNAMIC
    @id INT = NULL,
    @name NVARCHAR(120),
    @kind NVARCHAR(20) = NULL,          -- recompensa/cupon: FREE_PRODUCT, AMOUNT, PERCENT...
    @type NVARCHAR(20) = NULL,          -- dinamica: TIMING, WHEEL...
    @description NVARCHAR(400) = NULL,
    @product_id INT = NULL,
    @amount DECIMAL(12,2) = NULL,
    @discount_pct DECIMAL(5,2) = NULL,
    @valid_days INT = NULL,
    @uses_allowed INT = 1,
    @code_prefix NVARCHAR(8) = NULL,
    @target_value DECIMAL(12,4) = NULL,
    @tolerance DECIMAL(12,4) = NULL,
    @attempts_allowed INT = 1,
    @reward_definition_id INT = NULL,
    @active BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

    IF LTRIM(RTRIM(ISNULL(@name, N''))) = N''
    BEGIN RAISERROR('Falta el nombre.', 16, 1); RETURN; END
    IF ISNULL(@uses_allowed, 0) < 1 SET @uses_allowed = 1;

    IF @kind_of = 'REWARD'
    BEGIN
        IF @kind = 'FREE_PRODUCT' AND @product_id IS NULL
        BEGIN RAISERROR('Una recompensa de producto gratis necesita el producto.', 16, 1); RETURN; END
        IF @kind = 'AMOUNT' AND ISNULL(@amount, 0) <= 0
        BEGIN RAISERROR('Una recompensa de importe necesita un importe mayor que cero.', 16, 1); RETURN; END
        IF @kind = 'PERCENT' AND ISNULL(@discount_pct, 0) <= 0
        BEGIN RAISERROR('Una recompensa de porcentaje necesita un porcentaje mayor que cero.', 16, 1); RETURN; END

        IF @id IS NULL
        BEGIN
            INSERT INTO dbo.reward_definitions (name, kind, product_id, amount, discount_pct, notes, valid_days, uses_allowed, active)
            VALUES (@name, @kind, @product_id, @amount, @discount_pct, @description, @valid_days, @uses_allowed, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.reward_definitions
               SET name = @name, kind = @kind, product_id = @product_id, amount = @amount,
                   discount_pct = @discount_pct, notes = @description, valid_days = @valid_days,
                   uses_allowed = @uses_allowed, active = @active
             WHERE id = @id;

        SELECT id, name, kind, active FROM dbo.reward_definitions WHERE id = @id;
        RETURN;
    END

    IF @kind_of = 'COUPON'
    BEGIN
        IF @kind = 'FREE_PRODUCT' AND @product_id IS NULL
        BEGIN RAISERROR('Un cupon de producto gratis necesita el producto.', 16, 1); RETURN; END
        IF @kind = 'AMOUNT' AND ISNULL(@amount, 0) <= 0
        BEGIN RAISERROR('Un cupon de importe necesita un importe mayor que cero.', 16, 1); RETURN; END
        IF @kind = 'PERCENT' AND ISNULL(@discount_pct, 0) <= 0
        BEGIN RAISERROR('Un cupon de porcentaje necesita un porcentaje mayor que cero.', 16, 1); RETURN; END
        IF LTRIM(RTRIM(ISNULL(@code_prefix, N''))) = N'' SET @code_prefix = N'WYBIX';

        IF @id IS NULL
        BEGIN
            INSERT INTO dbo.coupon_definitions (name, kind, amount, discount_pct, product_id, valid_days, uses_allowed, code_prefix, active)
            VALUES (@name, @kind, @amount, @discount_pct, @product_id, @valid_days, @uses_allowed, @code_prefix, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.coupon_definitions
               SET name = @name, kind = @kind, amount = @amount, discount_pct = @discount_pct,
                   product_id = @product_id, valid_days = @valid_days,
                   uses_allowed = @uses_allowed, code_prefix = @code_prefix, active = @active
             WHERE id = @id;

        SELECT id, name, kind, active FROM dbo.coupon_definitions WHERE id = @id;
        RETURN;
    END

    IF @kind_of = 'DYNAMIC'
    BEGIN
        /* TIMING solo necesita el segundo objetivo.
           `tolerance` ya no participa: el juego es exacto a la centesima y
           exigir un margen mayor que cero impedia guardar justo la dinamica
           que se queria -"detenlo en 10.00 clavados"-. La columna se conserva
           porque hay definiciones viejas que la traen; simplemente se ignora. */
        IF @type = 'TIMING' AND ISNULL(@target_value, 0) <= 0
        BEGIN RAISERROR('Una dinamica de cronometro necesita el segundo objetivo.', 16, 1); RETURN; END
        IF ISNULL(@attempts_allowed, 0) < 1 SET @attempts_allowed = 1;

        IF @id IS NULL
        BEGIN
            INSERT INTO dbo.dynamic_definitions (name, type, description, target_value, tolerance, attempts_allowed, reward_definition_id, active)
            VALUES (@name, @type, @description, @target_value, @tolerance, @attempts_allowed, @reward_definition_id, @active);
            SET @id = SCOPE_IDENTITY();
        END
        ELSE
            UPDATE dbo.dynamic_definitions
               SET name = @name, type = @type, description = @description,
                   target_value = @target_value, tolerance = @tolerance,
                   attempts_allowed = @attempts_allowed,
                   reward_definition_id = @reward_definition_id, active = @active
             WHERE id = @id;

        SELECT id, name, type, active FROM dbo.dynamic_definitions WHERE id = @id;
        RETURN;
    END

    RAISERROR('Tipo de definicion desconocido.', 16, 1);
END
GO
