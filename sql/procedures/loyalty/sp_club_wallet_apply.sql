SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ===================== sp_club_wallet_apply (0066) =====================
   Pases de Wallet que esta caja debe reconocer: el que acaba de emitir y
   los que bajan de la nube (club_pull.wallet_passes).

   @payload = [{ serial, phone, customer_name }]

   Idempotente: un pase se reconoce por su serial; el teléfono no cambia
   (la nube da un pase por teléfono) y el nombre solo se completa.
   ============================================================================ */
CREATE OR ALTER PROCEDURE dbo.sp_club_wallet_apply
    @payload NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISJSON(@payload) <> 1 THROW 51000, N'Pases inválidos.', 1;

    ;WITH j AS (
        SELECT LOWER(LTRIM(RTRIM(x.serial))) AS serial,
               RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(x.phone, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'+', N''), N'.', N''), 10) AS tel,
               NULLIF(LTRIM(RTRIM(x.customer_name)), N'') AS customer_name
          FROM OPENJSON(@payload) WITH (serial NVARCHAR(40), phone NVARCHAR(40), customer_name NVARCHAR(120)) x
    )
    MERGE dbo.club_wallet_passes AS t
    USING (SELECT serial, MIN(tel) AS tel, MIN(customer_name) AS customer_name FROM j
            WHERE LEN(serial) = 24 AND serial NOT LIKE '%[^0-9a-f]%' AND LEN(tel) = 10 AND tel NOT LIKE '%[^0-9]%'
            GROUP BY serial) s
       ON t.serial = s.serial
     WHEN MATCHED AND t.customer_name IS NULL AND s.customer_name IS NOT NULL THEN UPDATE SET customer_name = s.customer_name
     WHEN NOT MATCHED THEN INSERT (serial, phone_key, customer_name) VALUES (s.serial, s.tel, s.customer_name);

    SELECT COUNT(*) AS pases FROM dbo.club_wallet_passes;
END
GO
