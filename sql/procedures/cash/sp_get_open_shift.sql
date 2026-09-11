/* sp_get_open_shift
 * Definicion canonica. Generada desde la base con scripts/db/extraer.mjs.
 * No editar en SSMS: modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* ====================== sp_get_open_shift ====================== */
CREATE OR ALTER PROCEDURE [dbo].[sp_get_open_shift]
  @user_id INT = NULL,
  @date    DATE = NULL,
  @register_id INT = NULL              -- multicaja
AS
BEGIN
  SET NOCOUNT ON;

  IF @register_id IS NULL
      SELECT TOP 1 @register_id = id FROM dbo.registers ORDER BY id;

  /* El turno abierto es el de la CAJA */
  SELECT TOP 1
    id,
    userId,
    create_date,
    opened_at,
    closed_at,
    opening_cash,
    opening_note,
    opening_user_id,
    register_id
  FROM dbo.cash_closures
  WHERE register_id = @register_id
    AND closed_at IS NULL
    AND (@date IS NULL OR create_date = @date)
  ORDER BY opened_at DESC;
END
GO
