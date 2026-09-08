/* 0001 — business profile
 *
 * Primera migracion productiva sobre WYBIX DATABASE BASELINE V1.
 *
 *   business_config.business_profile  RETAIL | HOSPITALITY  (default RETAIL)
 *     Perfil del NEGOCIO. Unica fuente de la capacidad Hospitality; el perfil
 *     del DISPOSITIVO vive en device-config.json de cada caja, no aqui.
 *   business_config.ticket_footer
 *     La aplicacion lo enviaba y el procedure lo rechazaba: se completa.
 *
 * Todas las instalaciones existentes quedan en RETAIL: exactamente como
 * operan hoy. Cada paso comprueba su existencia (idempotente).
 */

IF COL_LENGTH('dbo.business_config', 'ticket_footer') IS NULL
    ALTER TABLE dbo.business_config ADD ticket_footer NVARCHAR(300) COLLATE Modern_Spanish_CI_AS NULL;
GO

IF COL_LENGTH('dbo.business_config', 'business_profile') IS NULL
    ALTER TABLE dbo.business_config ADD business_profile NVARCHAR(20) COLLATE Modern_Spanish_CI_AS NOT NULL
        CONSTRAINT DF_business_config_business_profile DEFAULT ('RETAIL');
GO

IF OBJECT_ID(N'dbo.CK_business_config_business_profile', 'C') IS NULL
    ALTER TABLE dbo.business_config WITH CHECK ADD CONSTRAINT CK_business_config_business_profile
        CHECK ([business_profile]='HOSPITALITY' OR [business_profile]='RETAIL');
