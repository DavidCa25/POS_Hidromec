/**
 * QUE DEMOS CREO ESTE GESTOR.
 *
 * Un archivo en la carpeta de datos AISLADA de la demo -nunca en la de una
 * instalacion real, porque `aislarDatos` ya movio la raiz antes de que esto se
 * lea por primera vez- con una linea por perfil:
 *
 *     { "retail": { "instancia": "3f2a...", "base": "Wybix_Demo_Retail", ... } }
 *
 * PARA QUE SIRVE
 * --------------
 * Para la cuarta guarda. El marcador `is_demo` de la base dice "esto es una
 * demo"; este archivo dice "esta demo en concreto la hice yo". Hacen falta los
 * dos para destruir nada.
 *
 * La diferencia importa el dia que alguien copia una base de demostracion a
 * otra maquina, o escribe `is_demo = true` a mano en una base con nombre de
 * demo. En los dos casos el gestor de ESTA maquina no tiene el identificador y
 * se niega. Perder este archivo no rompe nada del producto: lo unico que pasa
 * es que esas demos hay que borrarlas a mano, y sus nombres son conocidos.
 *
 * NO ES UNA CREDENCIAL. No autoriza a nadie a hacer nada que no pudiera hacer
 * ya con acceso al servidor: solo estrecha lo que el gestor esta dispuesto a
 * tocar. Por eso es un JSON legible y no algo cifrado, que solo daria una
 * sensacion de secreto donde no hay secreto que guardar.
 */
const fs = require('fs');
const path = require('path');

const ARCHIVO = 'demo-instancias.json';

/** Siempre dentro de la carpeta ya aislada: `aislarDatos` corre antes. */
function ruta(app) {
  return path.join(app.getPath('userData'), ARCHIVO);
}

function leerTodo(app) {
  try {
    const txt = fs.readFileSync(ruta(app), 'utf8');
    const j = JSON.parse(txt);
    return (j && typeof j === 'object') ? j : {};
  } catch {
    /* No existir es lo normal la primera vez, y un archivo corrupto se trata
       igual que uno ausente: el gestor se negara a destruir, que es el lado
       seguro del error. */
    return {};
  }
}

function escribirTodo(app, datos) {
  const destino = ruta(app);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(datos, null, 2), 'utf8');
  return destino;
}

/** El identificador que este gestor guarda para un perfil, o `null`. */
function leer(app, perfilId) {
  const e = leerTodo(app)[perfilId];
  return (e && typeof e.instancia === 'string') ? e.instancia : null;
}

/** Anota la demo recien creada. Sustituye lo que hubiera del mismo perfil. */
function anotar(app, perfilId, { instancia, base }) {
  const todo = leerTodo(app);
  todo[perfilId] = { instancia, base, anotada: new Date().toISOString() };
  escribirTodo(app, todo);
  return instancia;
}

/** La quita del registro. Se llama DESPUES de borrar la base, no antes. */
function olvidar(app, perfilId) {
  const todo = leerTodo(app);
  if (!(perfilId in todo)) return false;
  delete todo[perfilId];
  escribirTodo(app, todo);
  return true;
}

module.exports = { ARCHIVO, ruta, leer, anotar, olvidar, leerTodo };
