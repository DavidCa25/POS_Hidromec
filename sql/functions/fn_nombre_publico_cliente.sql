/* fn_nombre_publico_cliente
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER FUNCTION dbo.fn_nombre_publico_cliente (@nombre NVARCHAR(120))
RETURNS NVARCHAR(20)
AS
BEGIN
    DECLARE @n NVARCHAR(120) = LTRIM(RTRIM(REPLACE(REPLACE(ISNULL(@nombre, N''), NCHAR(9), N' '), NCHAR(160), N' ')));
    IF @n = N'' RETURN NULL;
    /* Quien no es una persona no tiene nombre publico. */
    IF @n LIKE N'P_blico%' OR @n LIKE N'Mostrador%' OR @n LIKE N'Cliente general%' RETURN NULL;
    DECLARE @espacio INT = CHARINDEX(N' ', @n);
    DECLARE @primero NVARCHAR(120) = CASE WHEN @espacio > 0 THEN LEFT(@n, @espacio - 1) ELSE @n END;
    /* Un correo o un telefono capturado como nombre no se publica. */
    IF @primero LIKE N'%@%' OR @primero LIKE N'%[0-9]%' RETURN NULL;
    RETURN LEFT(@primero, 20);
END
GO
