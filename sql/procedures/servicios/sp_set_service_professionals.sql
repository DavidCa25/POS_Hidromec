/* sp_set_service_professionals
 * Definicion canonica. Modificar este archivo y crear una migracion.
 */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
/* Quien puede hacer este servicio. La lista completa, no altas sueltas.
 *
 * POR QUE LA LISTA ENTERA
 * -----------------------
 * La pantalla es una lista de casillas: el usuario marca y desmarca, y al
 * guardar lo que tiene en la cabeza es "estos cuatro". Mandar altas y bajas
 * por separado obligaria a la pantalla a llevar la cuenta de lo que cambio, y
 * esa cuenta es exactamente donde aparecen los estados imposibles.
 *
 * Una lista VACIA no es un error: significa "lo hace cualquiera". Es el estado
 * por omision y el que quiere un negocio pequeno, que no va a mantener una
 * matriz de quince servicios por ocho personas.
 *
 * Se recibe JSON y no una tabla de parametros por seguir lo que ya hace
 * `sp_set_product_modifier_groups`: un patron conocido vale mas que un tipo
 * nuevo para lo mismo.
 */
CREATE OR ALTER PROCEDURE dbo.sp_set_service_professionals
    @service_product_id INT,
    @asignaciones_json  NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE product_id = @service_product_id)
    BEGIN
        RAISERROR('Ese producto no es un servicio.', 16, 1);
        RETURN;
    END

    DECLARE @entrada TABLE (professional_id INT PRIMARY KEY, commission_pct DECIMAL(5, 2) NULL);

    INSERT INTO @entrada (professional_id, commission_pct)
    SELECT DISTINCT j.professional_id, j.commission_pct
      FROM OPENJSON(ISNULL(@asignaciones_json, '[]'))
           WITH (professional_id INT '$.professionalId',
                 commission_pct DECIMAL(5, 2) '$.commissionPct') j
     WHERE j.professional_id IS NOT NULL;

    IF EXISTS (SELECT 1 FROM @entrada e
                WHERE NOT EXISTS (SELECT 1 FROM dbo.professionals p WHERE p.id = e.professional_id))
    BEGIN
        RAISERROR('La lista incluye a alguien que ya no existe.', 16, 1);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM @entrada WHERE commission_pct < 0 OR commission_pct > 100)
    BEGIN
        RAISERROR('La comision va de 0 a 100.', 16, 1);
        RETURN;
    END

    BEGIN TRAN;

    MERGE dbo.service_professionals AS d
    USING (SELECT @service_product_id AS service_product_id, professional_id, commission_pct
             FROM @entrada) AS s
       ON d.service_product_id = s.service_product_id
      AND d.professional_id = s.professional_id
    WHEN MATCHED THEN UPDATE SET commission_pct = s.commission_pct
    WHEN NOT MATCHED BY TARGET THEN
        INSERT (service_product_id, professional_id, commission_pct)
        VALUES (s.service_product_id, s.professional_id, s.commission_pct)
    WHEN NOT MATCHED BY SOURCE AND d.service_product_id = @service_product_id THEN DELETE;

    COMMIT TRAN;

    SELECT sp.service_product_id, sp.professional_id, p.full_name, sp.commission_pct
      FROM dbo.service_professionals sp
      JOIN dbo.professionals p ON p.id = sp.professional_id
     WHERE sp.service_product_id = @service_product_id
     ORDER BY p.full_name;
END
GO
