/* sp_pedido_en_linea_aceptar
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · ACEPTAR un pedido en linea: abre su cuenta sin mesa (con numero del
   dia y codigo de seguimiento) y lo deja ACEPTADO. Devuelve las lineas para
   que la caja las envie a preparacion con el MISMO canal que Touch y Venta
   (salon.js#enviarOrden -> sp_hosp_orden_enviar), cuyo `origen` por linea es
   el uuid de la linea: reintentar no duplica nada en cocina.

   No cobra ni descuenta inventario: eso pasa al cobrar la cuenta en Touch.

   Antes de abrir nada se comprueba que cada producto y cada opcion siguen a
   la venta: si no, el pedido sigue PENDIENTE y la caja decide (rechazarlo).

   La cuenta se abre aqui y no con sp_hosp_cuenta_abrir porque aquel devuelve
   su propio resultado (sp_hosp_cuenta_get) y aceptar debe ser UNA
   transaccion: el numero del dia sale con la misma regla (MAX + 1 del dia,
   bajo bloqueo). */
CREATE OR ALTER PROCEDURE dbo.sp_pedido_en_linea_aceptar
    @id INT,
    @user_id INT = NULL,
    @register_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @estado NVARCHAR(12), @lineas NVARCHAR(MAX), @nombre NVARCHAR(60), @cuenta INT, @numero INT,
            @ahora DATETIME2 = SYSDATETIME(), @etiqueta NVARCHAR(60);

    BEGIN TRAN;
    SELECT @estado = estado, @lineas = lineas, @nombre = cliente_nombre, @cuenta = cuenta_id
      FROM dbo.pedidos_en_linea WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;
    IF @estado IS NULL BEGIN ROLLBACK TRAN; RAISERROR('El pedido no existe.', 16, 1); RETURN; END
    IF @estado = 'RECHAZADO' BEGIN ROLLBACK TRAN; RAISERROR('Este pedido ya se rechazó.', 16, 1); RETURN; END

    IF @estado = 'PENDIENTE'
    BEGIN
        IF EXISTS (SELECT 1 FROM OPENJSON(@lineas) WITH (product_id INT '$.product_id') l
                     LEFT JOIN dbo.products p ON p.id = l.product_id AND p.active = 1 AND p.sellable = 1
                    WHERE p.id IS NULL)
        BEGIN ROLLBACK TRAN; RAISERROR('Uno de los productos del pedido ya no está a la venta. Recházalo con ese motivo.', 16, 1); RETURN; END
        IF EXISTS (SELECT 1 FROM OPENJSON(@lineas) WITH (opciones NVARCHAR(MAX) '$.opciones' AS JSON) l
                    CROSS APPLY OPENJSON(l.opciones) WITH (option_id INT '$.option_id') o
                     LEFT JOIN dbo.modifier_options mo ON mo.id = o.option_id AND mo.active = 1
                    WHERE mo.id IS NULL)
        BEGIN ROLLBACK TRAN; RAISERROR('Una de las opciones del pedido ya no existe. Recházalo con ese motivo.', 16, 1); RETURN; END

        SELECT @numero = ISNULL(MAX(numero_dia), 0) + 1
          FROM dbo.hosp_cuentas WITH (UPDLOCK, HOLDLOCK)
         WHERE abierta_dia = CAST(@ahora AS DATE);
        /* La etiqueta la ven la caja y el KDS: de donde viene y quien recoge. */
        SET @etiqueta = LEFT(N'En línea · ' + LTRIM(RTRIM(@nombre)), 60);
        INSERT INTO dbo.hosp_cuentas (mesa_id, etiqueta, personas, abierta_por, register_id, abierta_en, numero_dia, seguimiento, customer_id)
        VALUES (NULL, @etiqueta, NULL, @user_id, @register_id, @ahora, @numero, CONVERT(CHAR(32), CRYPT_GEN_RANDOM(16), 2), NULL);
        SET @cuenta = SCOPE_IDENTITY();

        UPDATE dbo.pedidos_en_linea
           SET estado = 'ACEPTADO', cuenta_id = @cuenta, decidido_en = @ahora, decidido_por = @user_id
         WHERE id = @id;
    END
    COMMIT TRAN;

    /* ACEPTADO otra vez (reintento tras un fallo al enviar): mismas lineas,
       misma cuenta; sp_hosp_orden_enviar salta las que ya tiene. */
    SELECT p.id, p.uuid, p.cuenta_id, c.numero_dia, c.estado AS cuenta_estado
      FROM dbo.pedidos_en_linea p JOIN dbo.hosp_cuentas c ON c.id = p.cuenta_id
     WHERE p.id = @id;
    SELECT l.uuid AS origen, l.product_id, l.cantidad, l.nota, l.opciones
      FROM OPENJSON(@lineas) WITH (uuid UNIQUEIDENTIFIER '$.uuid', product_id INT '$.product_id',
                                   cantidad DECIMAL(12, 3) '$.cantidad', nota NVARCHAR(200) '$.nota',
                                   opciones NVARCHAR(MAX) '$.opciones' AS JSON) l;
END
GO
