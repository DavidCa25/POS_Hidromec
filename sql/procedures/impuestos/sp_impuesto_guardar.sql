/* sp_impuesto_guardar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_impuesto_guardar (0083) ======================
   Crea (@id NULL) o corrige un impuesto del catálogo. Cambiar una tasa o
   una cuota vale para las ventas de AHORA en adelante: las pasadas guardaron
   la suya en sale_detail_impuestos.

   De uno del sistema se corrige el valor, la nota y si está encendido; el
   nombre, la clase y el factor no (son la definición que se sembró).
   No se borra: se apaga. Apagarlo deja de calcularlo en las ventas nuevas
   aunque siga marcado en los productos.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_impuesto_guardar
    @id          INT = NULL,
    @nombre      NVARCHAR(80),
    @clase       VARCHAR(10),
    @factor      VARCHAR(6),
    @tasa        DECIMAL(9, 6) = NULL,
    @cuota       DECIMAL(12, 4) = NULL,
    @unidad      NVARCHAR(20) = NULL,
    @en_base_iva BIT = NULL,
    @nota        NVARCHAR(200) = NULL,
    @activo      BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    /* De uno del sistema manda su definición, no la que llegue. */
    IF @id IS NOT NULL
        SELECT @nombre = nombre, @clase = clase, @factor = factor, @unidad = unidad, @en_base_iva = en_base_iva
          FROM dbo.CAT_impuestos WHERE id = @id AND sistema = 1;

    SET @nombre = LTRIM(RTRIM(ISNULL(@nombre, N'')));
    IF @factor = 'Tasa' SET @cuota = NULL;
    IF @factor = 'Cuota' SET @tasa = NULL;
    IF @nombre = N'' THROW 51000, 'El impuesto necesita un nombre.', 1;
    IF @clase NOT IN ('IEPS', 'LOCAL') THROW 51000, 'Clase de impuesto desconocida.', 1;
    IF @factor NOT IN ('Tasa', 'Cuota') THROW 51000, 'El impuesto es por tasa o por cuota.', 1;
    IF @tasa IS NOT NULL AND (@tasa <= 0 OR @tasa > 5) THROW 51000, 'La tasa va de 0.01% a 500%.', 1;
    IF @cuota IS NOT NULL AND @cuota <= 0 THROW 51000, 'La cuota debe ser mayor a cero.', 1;
    IF @activo = 1 AND @tasa IS NULL AND @cuota IS NULL
        THROW 51000, 'Para encenderlo, captura su tasa o su cuota.', 1;

    IF @id IS NULL
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.CAT_impuestos WHERE nombre = @nombre)
            THROW 51000, 'Ya hay un impuesto con ese nombre.', 1;
        INSERT INTO dbo.CAT_impuestos (clave, nombre, clase, factor, tasa, cuota, unidad, en_base_iva, nota, activo, sistema)
        VALUES (CONCAT('TMP_', REPLACE(CONVERT(VARCHAR(36), NEWID()), '-', '')), @nombre, @clase, @factor, @tasa, @cuota, NULLIF(LTRIM(RTRIM(@unidad)), N''),
                ISNULL(@en_base_iva, CASE WHEN @clase = 'LOCAL' THEN 0 ELSE 1 END), NULLIF(LTRIM(RTRIM(@nota)), N''), @activo, 0);
        SET @id = SCOPE_IDENTITY();
        UPDATE dbo.CAT_impuestos SET clave = CONCAT('PROPIO_', @id) WHERE id = @id;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.CAT_impuestos WHERE id = @id) THROW 51000, 'Ese impuesto no existe.', 1;
        IF EXISTS (SELECT 1 FROM dbo.CAT_impuestos WHERE nombre = @nombre AND id <> @id)
            THROW 51000, 'Ya hay un impuesto con ese nombre.', 1;
        UPDATE dbo.CAT_impuestos
           SET nombre = @nombre, clase = @clase, factor = @factor, tasa = @tasa, cuota = @cuota,
               unidad = NULLIF(LTRIM(RTRIM(@unidad)), N''),
               en_base_iva = ISNULL(@en_base_iva, en_base_iva),
               nota = NULLIF(LTRIM(RTRIM(@nota)), N''),
               activo = @activo,
               actualizado_en = SYSDATETIME()
         WHERE id = @id;
    END

    SELECT @id AS id;
END
GO
