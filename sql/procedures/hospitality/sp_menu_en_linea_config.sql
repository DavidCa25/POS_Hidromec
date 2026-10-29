/* sp_menu_en_linea_config
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* 0067 · La configuracion del menu en linea (una fila). Sin parametros la
   lee; con @guardar = 1 la cambia. El slug es la direccion corta del menu
   (wybix.mx/m/<slug>): minusculas, numeros y guiones; la nube decide si esta
   libre al publicar. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_config
    @guardar BIT = 0,
    @activo BIT = NULL,
    @recibe_pedidos BIT = NULL,
    @slug NVARCHAR(40) = NULL,
    @minutos_estimados INT = NULL,
    @mensaje NVARCHAR(200) = NULL,
    @user_id INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.menu_en_linea_config WHERE id = 1)
        INSERT INTO dbo.menu_en_linea_config (id) VALUES (1);

    IF @guardar = 1
    BEGIN
        SET @slug = LOWER(NULLIF(LTRIM(RTRIM(@slug)), ''));
        IF @slug IS NOT NULL AND (LEN(@slug) < 3 OR @slug COLLATE Latin1_General_BIN LIKE '%[^a-z0-9-]%'
                                  OR LEFT(@slug, 1) = '-' OR RIGHT(@slug, 1) = '-')
        BEGIN RAISERROR('La dirección del menú lleva de 3 a 40 letras minúsculas, números o guiones.', 16, 1); RETURN; END
        IF ISNULL(@activo, 0) = 1 AND @slug IS NULL
        BEGIN RAISERROR('Elige la dirección del menú antes de publicarlo.', 16, 1); RETURN; END
        IF @minutos_estimados IS NOT NULL AND (@minutos_estimados < 1 OR @minutos_estimados > 240)
        BEGIN RAISERROR('El tiempo estimado va de 1 a 240 minutos.', 16, 1); RETURN; END

        UPDATE dbo.menu_en_linea_config
           SET activo = ISNULL(@activo, activo),
               recibe_pedidos = ISNULL(@recibe_pedidos, recibe_pedidos),
               slug = @slug,
               minutos_estimados = ISNULL(@minutos_estimados, minutos_estimados),
               mensaje = NULLIF(LTRIM(RTRIM(@mensaje)), ''),
               actualizado_en = SYSDATETIME(),
               actualizado_por = @user_id
         WHERE id = 1;
    END

    SELECT c.activo, c.recibe_pedidos, c.slug, c.minutos_estimados, c.mensaje, c.actualizado_en,
           (SELECT COUNT(*) FROM dbo.pedidos_en_linea WHERE estado = 'PENDIENTE') AS pendientes
      FROM dbo.menu_en_linea_config c WHERE c.id = 1;
END
GO
