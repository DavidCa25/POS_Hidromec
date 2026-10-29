/* asistencia_reglas
 * Definicion canonica del esquema. Reconstruida desde sys.* con
 * scripts/db/extraer-esquema.mjs. SQL Server no guarda el texto del
 * CREATE TABLE original, asi que esto es equivalente, no literal.
 */
IF OBJECT_ID(N'dbo.asistencia_reglas', 'U') IS NULL
BEGIN
CREATE TABLE dbo.asistencia_reglas (
    id TINYINT NOT NULL,
    cuenta_extra BIT NOT NULL CONSTRAINT DF_asistencia_reglas_extra DEFAULT ((1)),
    tolerancia_min SMALLINT NOT NULL CONSTRAINT DF_asistencia_reglas_tol DEFAULT ((10)),
    descanso_pagado BIT NOT NULL CONSTRAINT DF_asistencia_reglas_desc DEFAULT ((0)),
    dia_libre_extra BIT NOT NULL CONSTRAINT DF_asistencia_reglas_libre DEFAULT ((1)),
    marca_retardos BIT NOT NULL CONSTRAINT DF_asistencia_reglas_ret DEFAULT ((1)),
    entrada_para_vender BIT NOT NULL CONSTRAINT DF_asistencia_reglas_vender DEFAULT ((0)),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_asistencia_reglas_upd DEFAULT (sysdatetime()),
    updated_by INT NULL,
    CONSTRAINT PK_asistencia_reglas PRIMARY KEY CLUSTERED (id)
);
END;

IF OBJECT_ID(N'dbo.CK_asistencia_reglas_id', 'C') IS NULL
ALTER TABLE dbo.asistencia_reglas WITH CHECK ADD CONSTRAINT CK_asistencia_reglas_id CHECK ([id]=(1));

IF OBJECT_ID(N'dbo.CK_asistencia_reglas_tol', 'C') IS NULL
ALTER TABLE dbo.asistencia_reglas WITH CHECK ADD CONSTRAINT CK_asistencia_reglas_tol CHECK ([tolerancia_min]>=(0) AND [tolerancia_min]<=(120));
