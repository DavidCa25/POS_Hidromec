# Apps Wybix

El acceso Apps del dock y la barra lateral abre el mismo panel, cargado bajo demanda. qrcode y el panel de emparejamiento no se incluyen en el arranque. Owner conserva la invitación de un uso y los permisos del IPC existente; descargar un instalador no otorga acceso a un negocio.

Descargas públicas activas y verificadas el 7 de octubre de 2026:

- Owner: https://swlpspgmkwzlrowllvvj.supabase.co/functions/v1/app-download?app=owner
- POS Mobile: https://swlpspgmkwzlrowllvvj.supabase.co/functions/v1/app-download?app=mobile

La función pública solo admite esos dos destinos aprobados, sin recibir invitaciones ni credenciales. Los APK se alojan en DavidCa25/wybix-apps, separado de los releases del POS Windows, para conservar el contrato de autoactualización de este último. Ambos APK están publicados y sus hashes públicos coinciden con los artefactos verificados. Se verificó el formato APK descargando sin autenticación desde los enlaces de los QR.

Instalación Android: cámara → QR de descarga → APK → permiso de instalación del navegador cuando Android lo solicite. No requiere Expo Go. Luego Owner usa el QR de vinculación del negocio. En POS Mobile se captura el código que Owner genera en Eventos → evento → Tablets → Agregar tablet, con MFA y cupo del complemento.

La instalación de Owner conserva com.wybix.pos y su certificado existente en EAS, identidad comprobada en el commit d6779d6abec0bead786b13ebd22a9e3a08fde814. com.wybix.owner en la configuración reciente no coincidía con ese historial. No se reemplaza la llave por una nueva.

Verificación: npm run build; node scripts/pruebas/navegacion.mjs; node scripts/pruebas/dock-y-mascota.mjs; npx playwright test e2e/apps-wybix.spec.js. El E2E usa exclusivamente Wybix_E2E_Core y perfiles aislados. Incluye recorrido de administrador/cajera, ambos enlaces, separación de pasos, permiso de invitaciones, restauración de foco, barra lateral, eliminación de entradas antiguas y ajuste de panel a 1024/640 px.

Windows 1.3.1 está publicado como latest en POS_Hidromec. Instalador 925 881 064 bytes, SHA-256 60dae0aa59e0c6891fd31bf7c9c3cdd8e8270714511ecd366224ab1229bd080e. Los tres assets públicos (exe, blockmap, latest.yml) coinciden con los locales; latest.yml conserva el hash SHA-512 correcto. Dos bundles de Apps dentro de app.asar coinciden con el build probado. El borrador anterior de 1.3.1 se respaldó localmente antes de sustituir sus tres assets. No se modificó el release anterior 1.3.0.

El código permanece en el working tree (HEAD 2f6cc79 más los cambios de Apps); no equivale a un checkout limpio del tag publicado. No se hicieron commits adicionales ni push de fuentes. Esta publicación de instaladores no cambia el estado pendiente de las pruebas físicas de impresora y notificaciones.

## iPhone / iPad y web (1.3.2)

En Apps, cada app permite elegir Android o iPhone / iPad · Web. El QR público cambia con la elección; la opción web abre Safari y explica Compartir → Agregar a pantalla de inicio. Los QR existentes sin plataforma también reconocen iPhone, conservando APK para Android. La vinculación y sus permisos no cambian.

Owner web: https://wybix-owner.expo.app
POS Mobile web: https://wybix-pos-mobile.expo.app

Owner necesita red para sus consultas. POS Mobile conserva operación local cifrada con catálogo previamente descargado; sincroniza con la app abierta. La impresión web usa el diálogo del navegador, sin TCP directo; no se añadieron notificaciones Web Push. Instala el icono antes de vincular para no cambiar de perfil de almacenamiento.

Validación: build/instalador 1.3.2 correctos; dos E2E Electron de Apps (selección Android/Web, ambas apps, permisos de cajera/admin, foco y navegación). El chunk de Apps del app.asar coincide con el build probado. Release público y latest.yml verificados por hash y disponibilidad anónima.
