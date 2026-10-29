/* ============================================================
   0068 — Avisos por WhatsApp al cliente: pedido listo (esquema)

   whatsapp_pedido_avisos     Un renglón por pedido de mostrador cuyo aviso
                              «tu pedido está listo» se intentó. Es la
                              BANDERA: ENVIADO u OMITIDO no se vuelve a
                              intentar. `id` es la llave de idempotencia con
                              la nube (función whatsapp-avisos): reintentar
                              el mismo pedido nunca produce dos mensajes.

   El mensaje lo arma y lo manda la nube; los ajustes (encendido, apagado) y
   las bajas del cliente viven allá. Aquí solo el estado de cada pedido.
   El teléfono NO se copia: se lee de `customers` al momento de avisar.

   OMITIDO = la nube contestó que no va a salir (aviso apagado, el cliente se
   dio de baja, teléfono inválido): no es un error y no se reintenta.

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.whatsapp_pedido_avisos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.whatsapp_pedido_avisos (
        cuenta_id       INT              NOT NULL,
        id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_id DEFAULT (NEWID()),
        status          NVARCHAR(12)     COLLATE Modern_Spanish_CI_AS NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_status DEFAULT (N'ENVIANDO'),
        code            NVARCHAR(20)     COLLATE Modern_Spanish_CI_AS NULL,
        attempts        INT              NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_attempts DEFAULT (0),
        last_error      NVARCHAR(300)    COLLATE Modern_Spanish_CI_AS NULL,
        created_at      DATETIME2(0)     NOT NULL CONSTRAINT DF_whatsapp_pedido_avisos_created_at DEFAULT (SYSDATETIME()),
        last_attempt_at DATETIME2(0)     NULL,
        sent_at         DATETIME2(0)     NULL,
        CONSTRAINT PK_whatsapp_pedido_avisos PRIMARY KEY CLUSTERED (cuenta_id),
        CONSTRAINT UQ_whatsapp_pedido_avisos_id UNIQUE NONCLUSTERED (id),
        CONSTRAINT FK_whatsapp_pedido_avisos_cuenta FOREIGN KEY (cuenta_id) REFERENCES dbo.hosp_cuentas (id),
        CONSTRAINT CK_whatsapp_pedido_avisos_status CHECK (status IN (N'ENVIANDO', N'ENVIADO', N'OMITIDO', N'ERROR'))
    );
END;
GO
