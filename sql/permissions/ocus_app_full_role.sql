/* ocus_app_full_role
 *
 * Rol de base de datos con el que opera la aplicacion. `ocus_app` es su unico
 * miembro; el nombre es heredado (ver la auditoria en el decision log), la
 * funcion sigue siendo la correcta: dar a la caja lo justo para operar y
 * migrarse, sin ser db_owner.
 *
 * Hasta ahora este rol solo existia DENTRO de template.bak. Aqui queda su
 * definicion canonica: si manana hay que reconstruir la base desde Git, los
 * permisos vienen con ella.
 *
 * REFERENCES es el permiso que faltaba y que rompio la actualizacion a
 * Hospitality: sin el, SQL Server rechaza cualquier clave foranea (error
 * 1750 envolviendo un 1088), incluso hacia una tabla que el propio usuario
 * acaba de crear en la misma transaccion. Es estrictamente menos peligroso
 * que el ALTER que el rol ya tenia: permite apuntar a una tabla, no
 * modificarla.
 *
 * Idempotente: se puede reejecutar.
 */

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'ocus_app_full_role' AND type = 'R')
    CREATE ROLE [ocus_app_full_role];
GO

/* Datos: la operacion diaria. */
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo TO [ocus_app_full_role];

/* Ejecutar los procedures, que es como la aplicacion escribe. */
GRANT EXECUTE ON SCHEMA::dbo TO [ocus_app_full_role];

/* Migrarse a si misma: alterar tablas y crear objetos nuevos. */
GRANT ALTER ON SCHEMA::dbo TO [ocus_app_full_role];
GRANT REFERENCES ON SCHEMA::dbo TO [ocus_app_full_role];
GO

GRANT CREATE TABLE     TO [ocus_app_full_role];
GRANT CREATE VIEW      TO [ocus_app_full_role];
GRANT CREATE PROCEDURE TO [ocus_app_full_role];
GRANT CREATE FUNCTION  TO [ocus_app_full_role];
GRANT CREATE TYPE      TO [ocus_app_full_role];
GO
