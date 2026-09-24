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
