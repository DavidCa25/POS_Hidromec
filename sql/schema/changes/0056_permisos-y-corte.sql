/* ============================================================
   0056 — Permisos por usuario y lo que se queda en caja (esquema)

   user_permissions        PAQUETES EXTRA de una persona, encima de los de su
                           rol: un Operador de confianza que también hace
                           cortes o configura la impresora. Solo SUMAN, nunca
                           quitan: un permiso que el rol ya trae no se puede
                           retirar a una persona (eso sería otro rol).
                           Que paquetes se pueden otorgar lo decide el código
                           (electron/seguridad/permisos.js, OTORGABLES).
   cash_closures.cash_left Efectivo que se queda físicamente en la caja al
                           cerrar (fondo del siguiente turno). Lo demás se
                           retira.
   cash_closures.closing_note
                           Notas del cierre. La pantalla ya las pedía y se
                           perdían: el proceso principal no las guardaba.

   Aditiva: nada existente cambia de significado.
   ============================================================ */
IF OBJECT_ID(N'dbo.user_permissions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_permissions (
        user_id    INT          NOT NULL,
        permiso    VARCHAR(40)  NOT NULL,
        granted_by INT          NULL,
        granted_at DATETIME2(0) NOT NULL CONSTRAINT DF_user_permissions_granted_at DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_user_permissions PRIMARY KEY CLUSTERED (user_id, permiso),
        CONSTRAINT FK_user_permissions_user FOREIGN KEY (user_id) REFERENCES dbo.users (id)
    );
END;

IF COL_LENGTH('dbo.cash_closures', 'cash_left') IS NULL
    ALTER TABLE dbo.cash_closures ADD cash_left DECIMAL(12, 2) NULL;
IF COL_LENGTH('dbo.cash_closures', 'closing_note') IS NULL
    ALTER TABLE dbo.cash_closures ADD closing_note NVARCHAR(500) COLLATE Modern_Spanish_CI_AS NULL;
GO

IF OBJECT_ID(N'dbo.CK_cash_closures_cash_left', 'C') IS NULL
    ALTER TABLE dbo.cash_closures WITH CHECK ADD CONSTRAINT CK_cash_closures_cash_left
        CHECK (cash_left IS NULL OR (cash_left >= 0 AND cash_left <= cash_delivered));
GO
