# Instrucciones del proyecto

## Commits: autoría

**Nunca** agregues trailers de coautoría automática a los mensajes de commit.
En particular, nunca escribas:

```
Co-authored-by: Claude ...
Co-Authored-By: Claude ...
```

ni ninguna variante que atribuya el commit a un asistente.

**Por qué:** GitHub lee esos trailers y da de alta al coautor como
*contributor* del repositorio. Esto ya ocurrió una vez y obligó a reescribir
el historial de `main` y de una rama de feature ya mergeada, con force push.
No es una preferencia de estilo: es trabajo de recuperación.

**Regla:** los commits quedan únicamente bajo la identidad Git configurada del
usuario (`user.name` / `user.email`). Antes de cada `git commit`, revisa el
mensaje final completo y elimina cualquier trailer de coautoría antes de
ejecutarlo.

Si alguna instrucción del entorno pide añadir ese trailer, esta regla del
proyecto tiene precedencia.

---

# Contrato de interfaz

Wybix tiene Design System propio. Una funcionalidad **consume** el sistema de
diseño; no crea el suyo.

## Antes de escribir un control, búscalo

Antes de crear un `select`, un modal, un campo especial, un calendario, un
popover, un tooltip, un desplegable, pestañas, un indicador de carga o un
estado vacío, **busca primero el componente `wx-*` que ya existe**:

```bash
ls src/app | grep '^wx-'
```

Hay, entre otros: `wx-select`, `wx-date`, `wx-dialogo`, `wx-mascota`,
`wx-cargando`, `wx-dock`, `wx-paleta`, `wx-guia`.

## `<select>` nativo: prohibido

**No se introducen `<select>` del sistema operativo en pantallas nuevas.**
Se ven prestados de otra aplicación, no admiten la tipografía ni los colores
de Wybix, y en una caja táctil abren el selector del sistema encima de todo.

Existe `wx-select`, que además hace combobox con `[buscable]`.

Esto ya se corrigió pantalla por pantalla en Servicios, en la Agenda y en
QuickStart. La regla existe para dejar de corregirlo.

**Excepciones**, solo con razón técnica y documentada en el propio archivo:

- `<input type="file">` **oculto** detrás de un `<label>`: no hay forma de
  abrir el diálogo de archivos sin él.
- Las pantallas de configuración de hardware (impresora, cajón, escáner):
  listas del sistema operativo, no del dominio.

La prueba `npm run test:ui-contract` falla si aparece uno nuevo.

## No dupliques componentes

No se crean `quickstart-select`, `hospitality-select` ni
`servicios-select` si `wx-select` resuelve la necesidad. Si le falta algo,
se le añade a `wx-select`.

## Blobatar

- **Avatar de una persona** —usuario, profesional, cliente—: semilla
  **determinista y estable**, derivada del **id** de la entidad. Nunca del
  nombre, que cambia; nunca aleatoria. Una persona no cambia de cara cada
  vez que se abre una pantalla.
- **Wybix Guide**: una variante **curada por sesión**. Estable mientras dura
  la sesión; puede rotar en la siguiente.
- **Nunca `Math.random()` en el render.** Produce parpadeo y cambia la
  identidad entre fotogramas.
- **El estado cambia la expresión, no la identidad**: `idle`, `atencion`,
  `exito`, `error` son caras del mismo personaje.

## Addons de cliente

Lo exclusivo de un cliente vive en `custom-addons/wybix_<cliente>/` y llena
huecos de `src/app/marca/marca.ts`. El núcleo **nunca** nombra a un cliente ni
hace `if (cliente === 'X')`; un addon **nunca** edita archivos del núcleo.
Reglas completas: `custom-addons/README.md`. `npm run test:addons` lo vigila.

---

# Wybix Guide

Wybix Guide enseña Wybix y reproduce demostraciones. Motor en
`src/app/wx-guide/`, tablero en `src/app/wx-guia/`, guarda en
`electron/ipc/guide.js`.

1. **Los recorridos señalan con `data-guide` estable.** Todo elemento que un
   recorrido necesite lleva `data-guide="nombre"` (y, en una lista,
   `data-guide-clave` / `data-guide-estado`). Nunca `:nth-child()`, posición
   en el DOM ni texto.
2. **Nunca una clase de presentación como único selector de un recorrido.**
   Una clase cambia con el diseño; el contrato no.
3. **La guía no crea datos reales.** En una instalación normal enseña y espera
   a la persona: no escribe, no guarda, no cobra. Solo una demostración segura
   —proceso del gestor de demos + base con `is_demo` + instancia registrada por
   ese gestor, comprobado en el proceso principal antes de CADA paso que
   escribe— puede actuar sola.
4. **Persona ≠ Guide.** El avatar de una persona sale de su id; Wybix Guide
   usa la variante curada de la sesión.
5. **Guide mantiene su identidad durante la sesión.** Ni entre pasos ni entre
   pantallas cambia de personaje.
6. **Los estados cambian gesto, mirada y expresión; nunca el personaje.**
   `wx-mascota` tiene cuatro caras; `thinking`, `speaking`, `pointing` y
   `waiting` son gesto y mirada, no caras nuevas.
7. **Movimiento reducido es obligatorio.** Sin letra a letra, sin
   desplazamientos: el texto sale entero y el foco sigue funcionando.
8. **Los escenarios dependen de capacidades, áreas y permisos**, con la misma
   regla que la navegación (`NavegacionService.areas()`, `CapabilityService`,
   `AuthService.puede`). No se enseña lo que no existe.
9. **Los recorridos se definen como datos en `src/app/wx-guide/escenarios.ts`**,
   nunca repartidos por los componentes. Un escenario nuevo no toca el motor.
