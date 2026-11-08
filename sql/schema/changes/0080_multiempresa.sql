/* ============================================================
   0080 — MultiEmpresa (esquema)

   Varias empresas del mismo dueño, cada una en su propia base
   (docs/multiempresa.md).

   database_metadata('empresas_grupo')
                        el uuid del grupo. Sin la clave, la base no
                        pertenece a ningún grupo. No se crea aquí: la
                        escribe sp_empresas_grupo_fijar.

   empresas_grupo_bases las bases del grupo en ESTE servidor, incluida ella.
                        Cada miembro guarda la lista completa. Listar las
                        empresas lee solo esas bases (y comprueba que sigan
                        en el mismo grupo), nunca recorre todas las del
                        servidor: en SQL Express cada base cerrada tarda en
                        abrirse (AUTO_CLOSE) y una ajena con bloqueos
                        colgaría el selector.

   empresas_comandos    los cambios que pidió OTRA empresa del grupo desde
                        su computadora (Fase 3), con su resultado. Es la
                        bitácora y el candado de idempotencia: un comando
                        de la nube se aplica una sola vez aunque llegue dos.

   Aditiva: nada existente cambia.
   ============================================================ */

IF OBJECT_ID(N'dbo.empresas_grupo_bases', N'U') IS NULL
CREATE TABLE dbo.empresas_grupo_bases (
    base        SYSNAME      COLLATE DATABASE_DEFAULT NOT NULL CONSTRAINT PK_empresas_grupo_bases PRIMARY KEY CLUSTERED,
    agregada_en DATETIME2(0) NOT NULL CONSTRAINT DF_empresas_grupo_bases_agregada_en DEFAULT SYSDATETIME()
);
GO

IF OBJECT_ID(N'dbo.empresas_comandos', N'U') IS NULL
CREATE TABLE dbo.empresas_comandos (
    id              INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_empresas_comandos PRIMARY KEY CLUSTERED,
    comando_id      UNIQUEIDENTIFIER NOT NULL,
    tipo            NVARCHAR(30)  COLLATE Modern_Spanish_CI_AS NOT NULL,
    origen_empresa  NVARCHAR(200) COLLATE Modern_Spanish_CI_AS NOT NULL,
    origen_usuario  NVARCHAR(50)  COLLATE Modern_Spanish_CI_AS NULL,
    payload         NVARCHAR(MAX) COLLATE Modern_Spanish_CI_AS NOT NULL,
    resultado       NVARCHAR(10)  COLLATE Modern_Spanish_CI_AS NOT NULL,
    detalle         NVARCHAR(400) COLLATE Modern_Spanish_CI_AS NULL,
    product_id      INT NULL,
    aplicado_en     DATETIME2(0)  NOT NULL CONSTRAINT DF_empresas_comandos_aplicado_en DEFAULT SYSDATETIME(),
    CONSTRAINT UX_empresas_comandos_comando UNIQUE (comando_id),
    CONSTRAINT CK_empresas_comandos_resultado CHECK (resultado IN (N'APLICADO', N'RECHAZADO')),
    CONSTRAINT CK_empresas_comandos_tipo CHECK (tipo IN (N'PRODUCTO_ALTA', N'PRODUCTO_PRECIO'))
);
GO
