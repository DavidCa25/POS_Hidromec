/* ============================================================
   0084 — asistente preferencias

   Generada con scripts/db/generar-migracion.mjs desde los archivos
   canonicos de sql/. No editar a mano: regenerar.

   Idempotente: todos los objetos usan CREATE OR ALTER, y los tipos
   comprueban su existencia antes de crearse. Se puede reejecutar.

   Incluye el bloque de esquema sql/schema/changes/0084_asistente-preferencias.sql (tablas,
   columnas, seed). Cada paso de ese bloque comprueba su existencia.
   ============================================================ */

/* ========== ESQUEMA: sql/schema/changes/0084_asistente-preferencias.sql ========== */
/* ============================================================
   0084 — Wybix recuerda cómo le gusta a cada quien (esquema)

   asistente_preferencias  una fila por persona, con lo que pidió en el chat:
                           «llámame Jesús», «no me des el resumen», «sin
                           gráficas», «léeme las respuestas». JSON corto,
                           lo lee y lo escribe electron/asistente/store.js.

   Solo cambia cómo le habla Wybix a esa persona: nada del negocio.
   Aditiva: nada existente cambia.
   ============================================================ */

IF OBJECT_ID(N'dbo.asistente_preferencias', N'U') IS NULL
CREATE TABLE dbo.asistente_preferencias (
    user_id         INT            NOT NULL CONSTRAINT PK_asistente_preferencias PRIMARY KEY CLUSTERED,
    datos           NVARCHAR(1000) NOT NULL CONSTRAINT DF_asistente_preferencias_datos DEFAULT (N'{}'),
    actualizado_en  DATETIME2(0)   NOT NULL CONSTRAINT DF_asistente_preferencias_actualizado DEFAULT (SYSDATETIME()),
    CONSTRAINT CK_asistente_preferencias_json CHECK (ISJSON(datos) = 1)
);
GO
