/* sp_authorize_supervisor
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Comprueba la identidad de quien autoriza una operacion sensible.
 *
 * QUE CAMBIO Y POR QUE
 * --------------------
 * Antes filtraba por `rol IN ('admin','supervisor')`. Eso congelaba el modelo
 * viejo dentro de SQL: cualquier rol nuevo habria obligado a tocar este
 * procedimiento, y la pregunta que de verdad se hace -"¿esta persona puede
 * autorizar ESTA operacion?"- no es sobre su rol sino sobre el paquete que la
 * operacion exige.
 *
 * Ahora solo responde a lo que SQL puede responder de verdad: si las
 * credenciales son correctas y quien es esa persona. QUIEN PUEDE AUTORIZAR lo
 * decide el proceso principal con el catalogo de paquetes, que viaja en el
 * binario junto a las acciones que protege.
 *
 * LO QUE NO CAMBIA
 * ----------------
 * Que la contrasena se valide aqui, contra el hash de la base. Y que esto
 * siga existiendo aunque el paquete se pueda dar por rol: su valor no es
 * tecnico sino disuasorio. Nacio contra el robo hormiga, y que un cajero tenga que llamar
 * al encargado deja un rastro con nombre y hora que un permiso silencioso no
 * deja.
 */
CREATE OR ALTER PROCEDURE dbo.sp_authorize_supervisor
    @usuario NVARCHAR(50), @password NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @id INT, @rol NVARCHAR(20), @nombre NVARCHAR(50);

    SELECT TOP 1 @id = id, @nombre = usuario, @rol = rol
    FROM dbo.users
    WHERE usuario = @usuario
      AND active = 1
      AND password_hash = CONVERT(NVARCHAR(255), HASHBYTES('SHA2_256', @password), 2);

    IF @id IS NULL RETURN;      -- sin filas: credenciales incorrectas

    SELECT @id AS id, @nombre AS usuario, @rol AS rol;
END
GO
