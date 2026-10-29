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
   libre al publicar.

   0070 · Con @diseno = 1 se guardan TAMBIEN los datos de la plantilla
   (colores, frase, direccion, horario). Va aparte para que guardar la
   publicacion no borre el diseno, y al reves. */
CREATE OR ALTER PROCEDURE dbo.sp_menu_en_linea_config
    @guardar BIT = 0,
    @activo BIT = NULL,
    @recibe_pedidos BIT = NULL,
    @slug NVARCHAR(40) = NULL,
    @minutos_estimados INT = NULL,
    @mensaje NVARCHAR(200) = NULL,
    @user_id INT = NULL,
    @diseno BIT = 0,
    @color NVARCHAR(7) = NULL,
    @acento NVARCHAR(7) = NULL,
    @frase NVARCHAR(120) = NULL,
    @direccion NVARCHAR(200) = NULL,
    @horario NVARCHAR(120) = NULL
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

    IF @diseno = 1
    BEGIN
        SET @color = LOWER(NULLIF(LTRIM(RTRIM(@color)), ''));
        SET @acento = LOWER(NULLIF(LTRIM(RTRIM(@acento)), ''));
        IF (@color IS NOT NULL AND (LEN(@color) <> 7 OR @color COLLATE Latin1_General_BIN NOT LIKE '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))
        OR (@acento IS NOT NULL AND (LEN(@acento) <> 7 OR @acento COLLATE Latin1_General_BIN NOT LIKE '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))
        BEGIN RAISERROR('Los colores van como #rrggbb.', 16, 1); RETURN; END

        UPDATE dbo.menu_en_linea_config
           SET color = @color, acento = @acento,
               frase = NULLIF(LTRIM(RTRIM(@frase)), ''),
               direccion = NULLIF(LTRIM(RTRIM(@direccion)), ''),
               horario = NULLIF(LTRIM(RTRIM(@horario)), ''),
               actualizado_en = SYSDATETIME(),
               actualizado_por = @user_id
         WHERE id = 1;
    END

    SELECT c.activo, c.recibe_pedidos, c.slug, c.minutos_estimados, c.mensaje, c.actualizado_en,
           (SELECT COUNT(*) FROM dbo.pedidos_en_linea WHERE estado = 'PENDIENTE') AS pendientes,
           c.color, c.acento, c.frase, c.direccion, c.horario
      FROM dbo.menu_en_linea_config c WHERE c.id = 1;
END
GO
