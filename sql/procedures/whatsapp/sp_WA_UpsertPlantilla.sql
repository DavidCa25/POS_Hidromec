/* sp_WA_UpsertPlantilla
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER PROCEDURE sp_WA_UpsertPlantilla
    @Id INT,
    @Nombre NVARCHAR(100),
    @EventoTrigger VARCHAR(50),
    @Mensaje NVARCHAR(MAX),
    @Activo BIT
AS
BEGIN
    SET NOCOUNT ON;
    IF @Id = 0
    BEGIN
        INSERT INTO WA_Plantillas (Nombre, EventoTrigger, Mensaje, Activo, EsPorDefecto)
        VALUES (@Nombre, @EventoTrigger, @Mensaje, @Activo, 0);
    END
    ELSE
    BEGIN
        UPDATE WA_Plantillas
        SET Nombre = @Nombre,
            EventoTrigger = @EventoTrigger,
            Mensaje = @Mensaje,
            Activo = @Activo
        WHERE Id = @Id;
    END
END;
GO
