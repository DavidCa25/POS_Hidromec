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
