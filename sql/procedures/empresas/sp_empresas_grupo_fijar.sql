/* sp_empresas_grupo_fijar
 * Definicion canonica. Mantener este archivo y generar una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_empresas_grupo_fijar (0080) ====================
   Mete esta base en un grupo de empresas, o la saca (@grupo NULL).

   @bases   arreglo JSON con las bases del grupo en este servidor. Se guarda
            tal cual (siempre con esta base incluida): cada miembro tiene la
            lista completa, y quien la cambia la escribe en todos.

   Sacarla no borra nada: la empresa sigue operando sola, igual que antes
   de unirse. Cada base solo se escribe a si misma.
   ======================================================================= */
CREATE OR ALTER PROCEDURE dbo.sp_empresas_grupo_fijar
    @grupo UNIQUEIDENTIFIER = NULL,
    @bases NVARCHAR(MAX)    = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @bases IS NOT NULL AND ISJSON(@bases) <> 1
        THROW 51000, N'La lista de empresas no es valida.', 1;

    BEGIN TRAN;
        DELETE FROM dbo.empresas_grupo_bases;

        IF @grupo IS NULL
            DELETE FROM dbo.database_metadata WHERE clave = N'empresas_grupo';
        ELSE
        BEGIN
            DECLARE @valor NVARCHAR(255) = LOWER(CONVERT(NVARCHAR(36), @grupo));
            UPDATE dbo.database_metadata
               SET valor = @valor, actualizado_en = SYSDATETIME()
             WHERE clave = N'empresas_grupo';
            IF @@ROWCOUNT = 0
                INSERT INTO dbo.database_metadata (clave, valor) VALUES (N'empresas_grupo', @valor);

            INSERT INTO dbo.empresas_grupo_bases (base)
            SELECT CONVERT(SYSNAME, j.value)
              FROM OPENJSON(ISNULL(@bases, N'[]')) j
             WHERE LEN(LTRIM(RTRIM(j.value))) > 0
            UNION
            SELECT DB_NAME();
        END
    COMMIT;
END;
GO
