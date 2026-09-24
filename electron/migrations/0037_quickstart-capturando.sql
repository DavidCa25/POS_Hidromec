/* ============================================================
   0037 — QuickStart: una carga vacia no esta «analizando»

   QUE SE VIO EN QA
   ----------------
   Al entrar a la captura con lector, el riel decia:

       Capturado con lector
       ANALIZANDO · 0 renglones

   Nadie estaba analizando nada. La carga se creaba con el estado por
   omision -pensado para un archivo, que SI hay que leer- y como todavia no
   habia ninguna fila, `sp_import_batch_touch` no se habia llamado nunca.

   Una etiqueta que dice que el sistema esta trabajando cuando no lo esta
   ensena a desconfiar de las demas.

   LA CORRECCION
   -------------
   `CAPTURANDO`: la carga existe y esta esperando a que alguien escriba.
   Solo la ven las entradas de captura -libreta y lector-, y desaparece en
   cuanto hay una fila. No es un estado mas que explicarle a nadie: es el que
   faltaba para que los otros cuatro fueran verdad.

   Y ademas: una carga de captura VACIA que se abandona no se queda en el
   historial. Entrar y salir del lector cinco veces no puede dejar cinco
   lineas de cero renglones.
   ============================================================ */

IF OBJECT_ID(N'dbo.CK_import_batches_estado', 'C') IS NOT NULL
    ALTER TABLE dbo.import_batches DROP CONSTRAINT CK_import_batches_estado;
GO

ALTER TABLE dbo.import_batches WITH CHECK ADD CONSTRAINT CK_import_batches_estado
  CHECK (estado IN ('CAPTURANDO','ANALIZANDO','REVISION','LISTA','IMPORTADA','DESCARTADA'));
GO

/* Nace segun de donde viene: un archivo se analiza, una libreta se captura. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_create
    @origen NVARCHAR(12),
    @etiqueta NVARCHAR(200),
    @preset NVARCHAR(40) = NULL,
    @business_profile NVARCHAR(20) = NULL,
    @user_id INT = NULL,
    @metadata_json NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @estado NVARCHAR(12) =
        CASE WHEN @origen IN ('MANUAL','LECTOR') THEN 'CAPTURANDO' ELSE 'ANALIZANDO' END;

    INSERT INTO dbo.import_batches (origen, etiqueta, preset, business_profile, user_id, metadata_json, estado)
    VALUES (@origen, LEFT(LTRIM(RTRIM(@etiqueta)), 200), @preset, @business_profile, @user_id, @metadata_json, @estado);

    DECLARE @id INT = SCOPE_IDENTITY();
    SELECT * FROM dbo.import_batches WHERE id = @id;
END
GO

/* Recalcula el estado. Una carga de captura sin filas vuelve a CAPTURANDO en
   vez de caer en LISTA, que significaria «lista para importar» sobre nada. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_touch
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @total INT, @pend INT, @aplic INT, @origen NVARCHAR(12);
    SELECT @origen = origen FROM dbo.import_batches WHERE id = @batch_id;

    SELECT @total = COUNT(*),
           @pend  = SUM(CASE WHEN accion IN ('PENDIENTE','CONFLICT') THEN 1 ELSE 0 END),
           @aplic = SUM(CASE WHEN aplicada = 1 THEN 1 ELSE 0 END)
      FROM dbo.import_rows WHERE batch_id = @batch_id;

    UPDATE dbo.import_batches
       SET total_filas = ISNULL(@total, 0),
           updated_at = SYSDATETIME(),
           estado = CASE
               WHEN estado = 'DESCARTADA' THEN 'DESCARTADA'
               /* Sin una sola fila, una captura sigue siendo una captura. */
               WHEN ISNULL(@total, 0) = 0 AND @origen IN ('MANUAL','LECTOR') THEN 'CAPTURANDO'
               /* Importada solo cuando NO queda nada por hacer: si entraron
                  412 y quedan 16, la carga sigue viva. */
               WHEN @aplic > 0 AND ISNULL(@pend, 0) = 0
                    AND NOT EXISTS (SELECT 1 FROM dbo.import_rows
                                     WHERE batch_id = @batch_id AND aplicada = 0
                                       AND accion IN ('CREATE','UPDATE'))
                    THEN 'IMPORTADA'
               WHEN ISNULL(@pend, 0) > 0 THEN 'REVISION'
               ELSE 'LISTA' END
     WHERE id = @batch_id;
END
GO

/**
 * Tira una carga SOLO si esta vacia.
 *
 * Es lo que se llama al salir de la captura. La regla completa:
 *
 *   0 filas  -> se borra. No es trabajo de nadie, y dejarla llenaria el
 *               historial de lineas de cero renglones.
 *   >0 filas -> NO se toca. Son minutos de alguien copiando una libreta;
 *               se queda en el riel para volver cuando quiera.
 *
 * Borrar y no marcar DESCARTADA a proposito: una carga vacia no tiene nada
 * que contar, y el historial es para lo que paso.
 */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_drop_if_empty
    @batch_id INT
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM dbo.import_rows WHERE batch_id = @batch_id)
    BEGIN
        SELECT 0 AS borrada, 'tiene filas' AS motivo;
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.import_batches WHERE id = @batch_id AND estado = 'IMPORTADA')
    BEGIN
        SELECT 0 AS borrada, 'ya se importo' AS motivo;
        RETURN;
    END

    DELETE FROM dbo.import_batches WHERE id = @batch_id;
    SELECT @@ROWCOUNT AS borrada, 'vacia' AS motivo;
END
GO

/* El riel: las vivas primero, el historial despues. CAPTURANDO cuenta como
   viva, que es justo lo que hace que se pueda volver a ella. */
CREATE OR ALTER PROCEDURE dbo.sp_import_batch_list
    @incluir_historial BIT = 1,
    @tope INT = 40
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@tope)
        b.*,
        (SELECT COUNT(*) FROM dbo.import_rows r
          WHERE r.batch_id = b.id AND r.accion IN ('CONFLICT','PENDIENTE')) AS pendientes,
        (SELECT COUNT(*) FROM dbo.import_rows r
          WHERE r.batch_id = b.id AND r.accion IN ('CREATE','UPDATE') AND r.aplicada = 0) AS listas,
        u.usuario AS usuario
    FROM dbo.import_batches b
    LEFT JOIN dbo.users u ON u.id = b.user_id
    WHERE (@incluir_historial = 1 OR b.estado <> 'IMPORTADA')
      AND b.estado <> 'DESCARTADA'
    ORDER BY CASE WHEN b.estado = 'IMPORTADA' THEN 1 ELSE 0 END, b.created_at DESC;
END
GO
