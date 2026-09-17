/**
 * EL BUILD INTERNO. No se distribuye.
 *
 * POR QUE ES UN .js Y NO UN .json
 * -------------------------------
 * Dos razones, las dos aprendidas construyendo:
 *
 *   1. `extends: "package.json"` NO hereda el campo `build`: carga el archivo
 *      ENTERO como configuracion, y electron-builder falla con "unknown
 *      property 'devDependencies'". Aqui se toma exactamente el campo que
 *      hace falta.
 *   2. Un JSON no puede llevar comentarios. Una clave "//" tampoco: la
 *      configuracion se valida contra un esquema cerrado y cualquier
 *      propiedad desconocida detiene el empaquetado.
 *
 * QUE CAMBIA RESPECTO DEL PUBLICO
 * -------------------------------
 * Lo minimo: identidad, destino y las dos cosas que el publico no lleva. Todo
 * lo demas se DERIVA del build publico en vez de copiarse, asi que un recurso,
 * un icono o una version de SQL que se le anada al publico llega aqui sin que
 * nadie se acuerde de copiarlo. Un archivo duplicado se queda atras en la
 * primera version que alguien saque con prisa.
 *
 * EL appId ES DISTINTO A PROPOSITO
 * --------------------------------
 * Con el mismo, Windows trata las dos aplicaciones como una sola y el
 * instalador de cualquiera desinstala la otra. Distintos, conviven en la misma
 * maquina sin conocerse, que es justo lo que hace falta para ensenar una demo
 * en el equipo de alguien que ya usa Wybix.
 */
const { build } = require('./package.json');

/* El publico excluye `electron/demo` del paquete. El interno es el unico sitio
   donde esa carpeta debe viajar, asi que se quitan esas exclusiones -las que
   haya, ahora y en el futuro- en vez de reescribir la lista entera. */
const files = (build.files || []).filter(f => !/^!electron\/demo(\/|$)/.test(String(f)));

module.exports = {
  ...build,

  appId: 'com.wybix.pos.demo',
  productName: 'Wybix Demo',

  directories: { ...build.directories, output: 'release-internal' },

  files,

  /* Lo unico de mas: los perfiles declarativos que lee el gestor. */
  extraResources: [
    ...(build.extraResources || []),
    { from: 'demo-profiles', to: 'demo-profiles', filter: ['**/*'] },
  ],

  nsis: {
    ...build.nsis,
    shortcutName: 'Wybix Demo',
    artifactName: 'Wybix-Demo-Setup.exe',
  },
};
