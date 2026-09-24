/* sp_set_services_preset
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Guarda el giro de Servicios, y enciende el modulo en el mismo movimiento.
 *
 * LAS DOS COSAS JUNTAS, O NINGUNA
 * -------------------------------
 * Elegir giro y encender Servicios son una sola decision de quien la toma
 * -«mi negocio es un taller»- y separarlas deja dos estados a medias que hay
 * que explicar despues: el modulo encendido sin giro, y el giro guardado con
 * el modulo apagado. Por eso van en la misma transaccion y por eso este
 * procedimiento llama al del registro de modulos en vez de tener su propia
 * copia del MERGE: el registro sigue teniendo un unico sitio donde se
 * escribe.
 *
 * LO QUE NO VALIDA
 * ----------------
 * Que el giro exista. La lista de giros vive en electron/servicios/presets.json
 * y la comprueba el proceso principal antes de llamar aqui. Repetirla en un
 * CHECK convertiria anadir un giro en una migracion obligatoria para todo el
 * parque instalado, y el sexto giro no deberia costar eso. Lo que si se
 * exige es que venga algo: una cadena vacia no es una eleccion.
 *
 * NO BORRA NADA. Cambiar de giro cambia como se presenta el modulo -que
 * pestana abre, como se llama aqui un coche o una laptop- y no toca ni una
 * orden, ni un cliente, ni un activo. Un taller que se reinvente como taller
 * de electronicos conserva todo su historial.
 */
CREATE OR ALTER PROCEDURE [dbo].[sp_set_services_preset]
    @preset  NVARCHAR(40),
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @preset = UPPER(LTRIM(RTRIM(ISNULL(@preset, ''))));
    IF @preset = ''
    BEGIN
        RAISERROR('Falta el giro de Servicios.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    MERGE dbo.services_config AS d
    USING (SELECT 1 AS id) AS s
       ON d.id = s.id
     WHEN MATCHED THEN
          UPDATE SET preset = @preset, set_at = SYSDATETIME(), set_by = @user_id
     WHEN NOT MATCHED THEN
          INSERT (id, preset, set_at, set_by) VALUES (1, @preset, SYSDATETIME(), @user_id);

    /* El modulo, por su propia puerta. Encender Servicios escribe en
       `business_modules` y en ningun otro sitio, y ese procedimiento es el
       unico que sabe hacerlo bien -incluido el espejo a las columnas
       antiguas-. Duplicar aqui el MERGE habria sido tener dos formas de
       encender un modulo, y la de Servicios se habria quedado atras en
       cuanto la otra cambiara.

       Su resultado se recoge en una tabla temporal en vez de dejarlo salir.
       Si saliera, el primer conjunto que recibe quien llama seria el del
       modulo y no el del giro, y leer `recordset[0].preset` devolveria
       `undefined` sin que nada fallara: el peor tipo de error, el que no
       avisa. Si algun dia cambia la forma de ese SELECT, esto revienta al
       aplicar la migracion, que es cuando se quiere saber. */
    DECLARE @modulo TABLE (
        module_key NVARCHAR(40), enabled BIT, enabled_at DATETIME2(0),
        enabled_by INT, updated_at DATETIME2(0));
    INSERT INTO @modulo
    EXEC dbo.sp_set_business_module @module_key = N'servicios', @enabled = 1, @user_id = @user_id;

    COMMIT;

    SELECT preset, set_at, set_by FROM dbo.services_config WHERE id = 1;
END
GO
