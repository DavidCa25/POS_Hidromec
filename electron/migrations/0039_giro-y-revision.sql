/* ============================================================
   0039 — El giro del negocio llega a QuickStart

   QUE SE VIO EN QA
   ----------------
   En Demo Hospitality, cargar la hoja «Insumos» ofrecia «12 sin precio de
   venta · Ponerles precio» y proponia darle precio a doce ingredientes. La
   pantalla se revisaba ademas con las columnas de una tienda —Marca, Precio—
   y sin la Unidad, asi que «5000» no decia si eran gramos o litros.

   LA CAUSA, QUE NO ESTABA EN QUICKSTART
   -------------------------------------
   `business_modules` es el registro de modulos desde 0028. Su siembra inicial
   esta condicionada a que YA exista `business_config`:

       IF NOT EXISTS (... module_key = 'hospitality')
          AND EXISTS (SELECT 1 FROM dbo.business_config)

   En una base nueva eso NUNCA se cumple: las migraciones corren ANTES de que
   nadie de de alta el negocio. Despues `sp_setup_inicial` escribe
   `business_config.business_profile = 'HOSPITALITY'` y no toca el registro.
   Resultado: una Demo Hospitality con el perfil puesto y CERO filas en
   `business_modules`.

   El renderer sobrevive porque `CapabilityService` tiene un respaldo: si el
   registro viene vacio, lee el perfil. El proceso principal no lo tenia, asi
   que QuickStart preguntaba «¿es hospitality?» y le contestaban que no. La
   capa semantica estaba bien; el dato de entrada llegaba vacio.

   Dos clientes de un mismo hecho, dos respuestas distintas. Eso es lo que se
   arregla aqui, y se arregla en el DATO y no en cada consumidor.

   QUE CAMBIA
   ----------
   1. `sp_setup_inicial` da de alta el modulo al dar de alta el negocio, en la
      misma transaccion. Un negocio nace coherente.
   2. Relleno para las bases que ya nacieron torcidas.
   3. El filtro «Listas» deja fuera lo ya importado, para que el numero del
      chip y lo que se ve al pulsarlo sean lo mismo.
   ============================================================ */

/* ------------------------------------------------------------------
   1) RELLENO: las bases que ya existen y nacieron sin registro.

   Solo se escribe la fila que FALTA. Si alguien apago Hospitality a
   proposito, su fila existe y esto no la toca: apagar un modulo es una
   decision, y una migracion no la revoca.
   ------------------------------------------------------------------ */
IF OBJECT_ID(N'dbo.business_modules', 'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM dbo.business_config)
   AND NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = 'hospitality')
BEGIN
    INSERT INTO dbo.business_modules (module_key, enabled, enabled_at, updated_at)
    SELECT 'hospitality',
           CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(business_profile, '')))) = 'HOSPITALITY' THEN 1 ELSE 0 END,
           CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(business_profile, '')))) = 'HOSPITALITY' THEN SYSDATETIME() END,
           SYSDATETIME()
      FROM (SELECT TOP 1 business_profile FROM dbo.business_config ORDER BY id) AS b;
END
GO

IF OBJECT_ID(N'dbo.business_modules', 'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM dbo.business_config)
   AND NOT EXISTS (SELECT 1 FROM dbo.business_modules WHERE module_key = 'loyalty')
BEGIN
    INSERT INTO dbo.business_modules (module_key, enabled, enabled_at, updated_at)
    SELECT 'loyalty',
           CASE WHEN ISNULL(loyalty_enabled, 0) = 1 THEN 1 ELSE 0 END,
           CASE WHEN ISNULL(loyalty_enabled, 0) = 1 THEN SYSDATETIME() END,
           SYSDATETIME()
      FROM (SELECT TOP 1 loyalty_enabled FROM dbo.business_config ORDER BY id) AS b;
END
GO

/* ---------- sp_setup_inicial (SQL_STORED_PROCEDURE) ----------
   Definicion canonica. Modificar este archivo y crear una migracion.

   Lo unico que cambia respecto de 0007 es el bloque marcado abajo: el alta
   del negocio siembra tambien el registro de modulos. Va DENTRO de la misma
   transaccion a proposito: un negocio a medio dar de alta —con perfil y sin
   modulo— es exactamente el estado que produjo este fallo.
*/
CREATE OR ALTER PROCEDURE dbo.sp_setup_inicial
    @usuario        NVARCHAR(100),
    @password       NVARCHAR(100),
    @business_name  NVARCHAR(200) = NULL,
    @address        NVARCHAR(300) = NULL,
    @phone          NVARCHAR(50)  = NULL,
    @rfc            NVARCHAR(50)  = NULL,
    @business_profile NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF EXISTS (SELECT 1 FROM dbo.users)
    BEGIN
        RAISERROR('El sistema ya fue configurado.', 16, 1);
        RETURN;
    END

    IF LEN(LTRIM(RTRIM(@usuario))) < 3
    BEGIN
        RAISERROR('El usuario debe tener al menos 3 caracteres.', 16, 1);
        RETURN;
    END

    IF LEN(@password) < 6
    BEGIN
        RAISERROR('La contrasena debe tener al menos 6 caracteres.', 16, 1);
        RETURN;
    END

    IF @business_profile IS NOT NULL
    BEGIN
        SET @business_profile = UPPER(LTRIM(RTRIM(@business_profile)));
        IF @business_profile NOT IN ('RETAIL', 'HOSPITALITY')
        BEGIN
            RAISERROR('business_profile invalido: use RETAIL o HOSPITALITY.', 16, 1);
            RETURN;
        END
    END

    BEGIN TRY
        BEGIN TRAN;

        INSERT INTO dbo.users (usuario, password_hash, rol, active, creation_date)
        VALUES (
            @usuario,
            CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2),
            N'admin',
            1,
            GETDATE()
        );

        DECLARE @user_id INT = SCOPE_IDENTITY();

        IF NOT EXISTS (SELECT 1 FROM dbo.business_config)
        BEGIN
            INSERT INTO dbo.business_config
                (business_name, address, phone, rfc, business_profile, invoicing_enabled, updated_at)
            VALUES
                (@business_name, @address, @phone, @rfc,
                 ISNULL(@business_profile, 'RETAIL'), 0, GETDATE());
        END

        /* ------------------------------------------- EL REGISTRO DE MODULOS
           Un negocio de alimentos nace con Hospitality encendido AQUI, y no
           solo con el perfil escrito. El perfil quedo como «con que nacio el
           negocio»; quien gobierna el comportamiento es el registro, y hasta
           ahora nadie lo escribia en el alta. */
        IF OBJECT_ID(N'dbo.business_modules', 'U') IS NOT NULL
        BEGIN
            DECLARE @hosp BIT =
                CASE WHEN ISNULL(@business_profile, 'RETAIL') = 'HOSPITALITY' THEN 1 ELSE 0 END;

            MERGE dbo.business_modules AS d
            USING (SELECT 'hospitality' AS module_key) AS s ON d.module_key = s.module_key
            WHEN MATCHED AND d.enabled <> @hosp
              THEN UPDATE SET enabled = @hosp,
                              enabled_at = CASE WHEN @hosp = 1 THEN SYSDATETIME() ELSE enabled_at END,
                              updated_at = SYSDATETIME()
            WHEN NOT MATCHED
              THEN INSERT (module_key, enabled, enabled_at, updated_at)
                   VALUES ('hospitality', @hosp,
                           CASE WHEN @hosp = 1 THEN SYSDATETIME() END, SYSDATETIME());
        END

        COMMIT TRAN;

        SELECT @user_id AS user_id, @usuario AS usuario;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRAN;
        DECLARE @msg NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

/* ---------- sp_import_rows_get (SQL_STORED_PROCEDURE) ----------
   Definicion canonica. Modificar este archivo y crear una migracion.

   «Listas» deja fuera lo ya importado. El resumen ya contaba solo
   `aplicada = 0` desde 0038, asi que el chip decia «Listas 0» y al pulsarlo
   aparecian las nueve que ya habian entrado. El numero y la lista tienen que
   ser la misma cosa; lo que ya entro se ve en «Todas».
*/
CREATE OR ALTER PROCEDURE dbo.sp_import_rows_get
    @batch_id INT,
    @filtro NVARCHAR(20) = NULL,   -- TODAS | LISTAS | PENDIENTES | CONFLICTOS
    @desde INT = 0,
    @tope INT = 200
AS
BEGIN
    SET NOCOUNT ON;
    SELECT r.*
    FROM dbo.import_rows r
    WHERE r.batch_id = @batch_id
      AND (@filtro IS NULL OR @filtro = 'TODAS'
           OR (@filtro = 'LISTAS'     AND r.accion IN ('CREATE','UPDATE') AND r.aplicada = 0)
           OR (@filtro = 'PENDIENTES' AND r.accion IN ('CONFLICT','PENDIENTE'))
           OR (@filtro = 'CONFLICTOS' AND r.accion = 'CONFLICT'))
    ORDER BY r.fila
    OFFSET @desde ROWS FETCH NEXT @tope ROWS ONLY;
END
GO
