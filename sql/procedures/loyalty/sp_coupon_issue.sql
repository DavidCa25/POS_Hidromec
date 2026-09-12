/* sp_coupon_issue
 * Definicion canonica. Modificar aqui y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ============================================================
   sp_coupon_issue — emitir cupones sin que haya una venta.

   POR QUE HACE FALTA
   ------------------
   Hasta ahora un cupon solo nacia dentro de `sp_loyalty_evaluate_sale`:
   habia que crear una campana que lo entregase y esperar a que alguien
   comprase. Definir el cupon y quedarse ahi no servia de nada, y desde la
   pantalla no habia ningun boton que lo convirtiera en codigos usables.

   Esto cubre el otro caso, que es igual de real: repartir codigos a mano.
   Un taco de volantes, una promocion en redes, veinte cupones para el
   cliente que trae un coche de flota. No hay venta, no hay campana y puede
   no haber cliente: las tres columnas admiten NULL precisamente por eso.

   LO QUE NO CAMBIA
   ----------------
   El cupon emitido aqui es EXACTAMENTE el mismo objeto que el que emite una
   campana: mismo estado, mismo prefijo, misma caducidad, mismos usos. Lo
   valida y lo canjea el mismo procedimiento de siempre. Si fuera otra cosa,
   habria dos tipos de cupon y dos reglas para gastarlos.

   EL CODIGO
   ---------
   Se inserta con un valor provisional unico y despues se reescribe con el
   `id` ya asignado: PREFIJO-000123. Es el mismo metodo que usa la
   evaluacion de la venta, y por la misma razon: el numero legible sale del
   IDENTITY, que es lo unico que garantiza que no se repite.
   ============================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_coupon_issue
    @definition_id INT,
    @quantity      INT = 1,
    @customer_id   INT = NULL,
    @machine_id    NVARCHAR(64) = NULL,
    @register_id   INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ahora DATETIME2(0) = SYSDATETIME();

    /* Un tope sensato. No es una limitacion tecnica: es que pedir cinco mil
       cupones de golpe casi siempre es un cero de mas, y deshacerlo despues
       obliga a anular uno por uno. */
    IF @quantity IS NULL OR @quantity < 1 OR @quantity > 500
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'CANTIDAD' AS motivo,
               N'La cantidad tiene que estar entre 1 y 500.' AS mensaje;
        RETURN;
    END

    DECLARE @activo BIT, @usos INT, @dias INT, @prefijo NVARCHAR(8);
    SELECT @activo = active, @usos = uses_allowed,
           @dias = valid_days, @prefijo = code_prefix
      FROM dbo.coupon_definitions
     WHERE id = @definition_id;

    IF @activo IS NULL
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'NO_EXISTE' AS motivo,
               N'Ese cupón no existe.' AS mensaje;
        RETURN;
    END

    /* Emitir codigos de un cupon apagado dejaria en la calle papeles que no
       se pueden canjear. El cajero veria "cupón no válido" y no sabria por
       que. Se enciende primero. */
    IF @activo = 0
    BEGIN
        SELECT CAST(0 AS BIT) AS ok, N'APAGADO' AS motivo,
               N'Enciende el cupón antes de emitirlo: los códigos no se podrían canjear.' AS mensaje;
        RETURN;
    END

    DECLARE @nuevos TABLE (id INT NOT NULL);

    BEGIN TRY
        BEGIN TRANSACTION;

        /* Una fila por cupon pedido. `sys.all_objects` es solo un generador
           de filas: no se lee nada de el. */
        INSERT INTO dbo.coupon_instances
            (definition_id, campaign_id, customer_id, code, sale_id, register_id,
             machine_id, status, uses_allowed, issued_at, expires_at)
        OUTPUT INSERTED.id INTO @nuevos(id)
        SELECT TOP (@quantity)
               @definition_id, NULL, @customer_id,
               LEFT(REPLACE(CAST(NEWID() AS NVARCHAR(36)), '-', ''), 24),
               NULL, @register_id, @machine_id,
               'ISSUED', @usos, @ahora,
               CASE WHEN @dias IS NULL THEN NULL ELSE DATEADD(DAY, @dias, @ahora) END
          FROM sys.all_objects;

        UPDATE ci
           SET code = CONCAT(@prefijo, '-', RIGHT(CONCAT('00000', CAST(ci.id AS NVARCHAR(20))), 6))
          FROM dbo.coupon_instances ci
          JOIN @nuevos n ON n.id = ci.id;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT CAST(0 AS BIT) AS ok, N'ERROR' AS motivo, ERROR_MESSAGE() AS mensaje;
        RETURN;
    END CATCH

    /* Se devuelven los codigos recien creados: quien los pidio tiene que
       poder imprimirlos o dictarlos sin ir a buscarlos a otra pantalla. */
    SELECT CAST(1 AS BIT) AS ok, N'OK' AS motivo,
           CAST(NULL AS NVARCHAR(200)) AS mensaje,
           ci.id, ci.code, ci.expires_at, ci.uses_allowed
      FROM dbo.coupon_instances ci
      JOIN @nuevos n ON n.id = ci.id
     ORDER BY ci.id;
END
