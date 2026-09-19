/* ============================================================
   0032 — El giro del modulo Servicios.

   UNA SOLA COSA: recordar que clase de negocio de servicios es este, para
   que el modulo se presente como corresponde —que pestana abre, como se
   llama aqui la cosa sobre la que se trabaja— desde el primer dia y no
   despues de que alguien lo configure a mano.

   POR QUE UNA TABLA PROPIA Y NO UNA COLUMNA EN business_config
   ------------------------------------------------------------
   Lo dice la propia 0028 al crear el registro de modulos: «sin columna
   config: un JSON generico acaba siendo el sitio donde cae todo lo que
   nadie quiso modelar. El modulo que necesite configuracion tendra su
   tabla». Esta es la de Servicios. business_config es del NEGOCIO —su
   nombre, su direccion, su ticket—; el giro es del MODULO, y un negocio
   que apague Servicios no deberia arrastrar una columna suya para siempre.

   POR QUE EL CATALOGO DE GIROS NO ESTA AQUI
   -----------------------------------------
   Solo se guarda el identificador elegido. Que enciende cada giro, como se
   llama y que ejemplos da vive en electron/servicios/presets.json, que es
   lo que leen la interfaz, el proceso principal y el gestor de demos. Si
   estuviera tambien aqui habria dos catalogos, y el de la base solo se
   actualizaria con una migracion: el dia que se anada un giro, las
   instalaciones viejas lo rechazarian por no conocerlo.

   Y POR QUE NO HAY CHECK CONSTRAINT CONTRA UNA LISTA
   ---------------------------------------------------
   Por lo mismo. Un CHECK con los cinco giros de hoy convierte anadir el
   sexto en una migracion obligatoria para todo el parque. La lista valida
   la comprueba el proceso principal contra el JSON, que es donde puede
   cambiar sin romper nada.

   Todo idempotente. Una instalacion que actualice no ve ninguna diferencia:
   sin fila, el modulo se comporta exactamente como se comportaba.
   ============================================================ */

IF OBJECT_ID(N'dbo.services_config', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.services_config (
        /* Una sola fila, siempre. El CHECK lo garantiza sin depender de que
           nadie se equivoque: no es una tabla de catalogo, es la
           configuracion del modulo para ESTE negocio. */
        id          TINYINT       NOT NULL CONSTRAINT PK_services_config PRIMARY KEY
                                  CONSTRAINT CK_services_config_fila_unica CHECK (id = 1),
        preset      NVARCHAR(40)  COLLATE Modern_Spanish_CI_AS NOT NULL,
        set_at      DATETIME2(0)  NOT NULL CONSTRAINT DF_services_config_set_at DEFAULT (SYSDATETIME()),
        set_by      INT           NULL
    );
END;
GO

IF OBJECT_ID(N'dbo.FK_services_config_user', 'F') IS NULL
   AND OBJECT_ID(N'dbo.services_config', 'U') IS NOT NULL
ALTER TABLE dbo.services_config WITH NOCHECK
  ADD CONSTRAINT FK_services_config_user FOREIGN KEY (set_by) REFERENCES dbo.users (id);
GO

/* ------------------------------------------------- nada que sembrar

   A proposito. La fila ausente significa «este negocio no ha elegido giro»,
   y eso es verdad en toda instalacion que venga de antes: encendio Servicios
   cuando los giros no existian. Sembrar 'OTRO' aqui seria escribirle una
   decision que no tomo, y ademas le quitaria al producto la unica forma de
   distinguir «eligio el generico» de «no ha elegido». La interfaz resuelve
   la ausencia con el mismo comportamiento de siempre. */
GO
