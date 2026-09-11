# Prueba de instalación en máquina limpia

Lo único que no se puede automatizar desde la máquina de desarrollo: instalar
Wybix en un Windows que nunca ha tenido SQL Server y comprobar que el cliente
acaba vendiendo.

Todo lo demás está cubierto por pruebas automáticas. Esto valida las tres cosas
que ninguna de ellas puede tocar: que NSIS despliegue SQL Express de cero, que
el parche de seguridad se aplique de verdad, y que el asistente complete el
alta del administrador contra esa instancia recién creada.

---

## Antes de empezar

- [ ] Windows 10 u 11 x64 limpio, **sin ninguna instancia de SQL Server**
- [ ] Usuario con permisos de administrador local
- [ ] `Wybix-Setup.exe` del release a probar
- [ ] Sin conexión a internet, si se quiere validar el caso offline real

Anotar antes de instalar:

```
Windows            ____________________
Versión de Wybix   ____________________
SHA256 del .exe    ____________________
```

---

## 1. Instalación

- [ ] Ejecutar `Wybix-Setup.exe`
- [ ] Completa sin errores
- [ ] Si Windows pide reinicio al terminar, reiniciar antes de seguir

## 2. Motor SQL Server

- [ ] El servicio `MSSQL$SQLEXPRESS` existe y está **Running**
- [ ] El servicio `SQLBrowser` está **Running**

Consultar el build:

```sql
SELECT @@VERSION;
SELECT SERVERPROPERTY('ProductVersion'), SERVERPROPERTY('ProductLevel'),
       SERVERPROPERTY('ProductUpdateLevel'), SERVERPROPERTY('Edition');
```

- [ ] `ProductVersion` = **15.0.2180.2** ← lo que prueba que el GDR se aplicó
- [ ] `Edition` = Express Edition (64-bit)
- [ ] **No** es 15.0.2000.5: si lo es, el servicing falló y la instalación
      debería haberse detenido sola

Anotar:

```
ProductVersion      ____________________
ProductLevel        ____________________
ProductUpdateLevel  ____________________
```

## 3. Base de datos

- [ ] La base de Wybix existe
- [ ] `SELECT COUNT(*) FROM schema_migrations` devuelve **6**
- [ ] `SELECT valor FROM database_metadata WHERE clave='baseline_version'` = **1**
- [ ] `SELECT COUNT(*) FROM users` = **0** antes del asistente
- [ ] `SELECT COUNT(*) FROM products` = **0**

## 4. Asistente

- [ ] Arranca el asistente de instalación
- [ ] Paso 2: nombre del negocio y **tipo** (Comercio / Alimentos y bebidas)
- [ ] Paso 3: alta del administrador
- [ ] Paso 3.5: **uso de esta computadora**, con la opción recomendada marcada
- [ ] El botón *Continuar* es alcanzable sin recortes en 1366×768
- [ ] Termina y entra a la aplicación

## 5. Retail

- [ ] Iniciar sesión con el administrador recién creado
- [ ] Dar de alta un producto con precio y existencias
- [ ] Registrar una venta en efectivo
- [ ] El cambio es correcto
- [ ] Las existencias bajan
- [ ] Se genera el PDF del ticket

## 6. Touch

- [ ] Cambiar el perfil del dispositivo a **Punto de venta táctil**
- [ ] El catálogo carga y las tarjetas se ven completas
- [ ] Agregar productos y cobrar
- [ ] El modal del cambio muestra el importe

## 7. Respaldo

- [ ] Configuración › Respaldos: ejecutar un respaldo manual
- [ ] El `.bak` aparece en `C:\POS_Backups`
- [ ] **No aparece** el error «BACKUP DATABASE is terminating abnormally»
- [ ] `backup-config.json` registra `lastStatus: ok`

## 8. Caja secundaria (si hay una segunda máquina)

- [ ] Instalar Wybix en la segunda máquina
- [ ] Configurarla contra la IP del host con el login de red
- [ ] Conecta y vende
- [ ] En su log aparece `[BACKUP] esta caja no es el host: no se programan respaldos`
- [ ] La exportación de base se rechaza con mensaje claro
- [ ] **No** instala ni parchea SQL Server

---

## Casos que conviene forzar

| Caso | Cómo | Qué debe pasar |
|---|---|---|
| SQL Server ya instalado y al día | máquina con 15.0.2180.2 o superior | no se parchea; instala y sigue |
| SQL Server 2019 sin parchear | máquina con 15.0.2000.5 preexistente | avisa en el log y **continúa**; nunca bloquea |
| SQL Server no soportado | máquina con 2017 o 2022 | se reporta y se detiene; **no** lo modifica |
| Reinicio pendiente | el parche devuelve 3010 | se trata como éxito; el servicio vuelve a Running antes de seguir |

---

## Resultado

```
Fecha            ____________________
Probado por      ____________________
Máquina          ____________________

ProductVersion final   ____________________
Retail                 [ ] ok   [ ] falla: ______________________
Touch                  [ ] ok   [ ] falla: ______________________
Respaldo               [ ] ok   [ ] falla: ______________________
Secundaria             [ ] ok   [ ] n/a   [ ] falla: ____________

PRODUCTION INSTALL VERIFIED   [ ] SÍ   [ ] NO
```

Mientras esta casilla no esté marcada, el release es **candidato**, no
verificado en producción.
