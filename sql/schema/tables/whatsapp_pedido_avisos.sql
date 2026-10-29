/* whatsapp_pedido_avisos
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.whatsapp_pedido_avisos', 'U') IS NULL
BEGIN
CREATE TABLE dbo.whatsapp_pedido_avisos (
    cuenta_id INT NOT NULL,
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_id DEFAULT (newid()),
    status NVARCHAR(12) COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_status DEFAULT (N'ENVIANDO'),
    code NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NULL,
    attempts INT NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_attempts DEFAULT ((0)),
    last_error NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_created_at DEFAULT (sysdatetime()),
    last_attempt_at DATETIME2(0) NULL,
    sent_at DATETIME2(0) NULL,
    CONSTRAINT PK_whatsapp_pedido_avisos PRIMARY KEY CLUSTERED (cuenta_id),
    CONSTRAINT UQ_whatsapp_pedido_avisos_id UNIQUE NONCLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_whatsapp_pedido_avisos_status', 'C') IS NULL
ALTER TABLE dbo.whatsapp_pedido_avisos WITH CHECK ADD CONSTRAINT CK_whatsapp_pedido_avisos_status CHECK ([status]=N'ERROR' OR [status]=N'OMITIDO' OR [status]=N'ENVIADO' OR [status]=N'ENVIANDO');

IF OBJECT_ID(N'dbo.FK_whatsapp_pedido_avisos_cuenta', 'F') IS NULL
ALTER TABLE dbo.whatsapp_pedido_avisos WITH CHECK ADD CONSTRAINT FK_whatsapp_pedido_avisos_cuenta FOREIGN KEY (cuenta_id) REFERENCES dbo.hosp_cuentas (id);
