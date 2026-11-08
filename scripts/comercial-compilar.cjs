const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync('shared/comercial.ts','utf8');
const out=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
fs.mkdirSync('electron/comercial',{recursive:true});

/* Se escribe SOLO si el contenido cambió, y con el fin de línea que ya tenía
   el archivo. Antes se reescribía en cada compilación con LF, y en Windows
   (core.autocrlf) git lo marcaba como modificado sin que nada cambiara: el
   «M motor.cjs» que bloqueaba el `git pull` con rebase. */
const DESTINO='electron/comercial/motor.cjs';
const nuevo='// Generado desde shared/comercial.ts por scripts/comercial-compilar.cjs.\n'+out.outputText;
const actual=fs.existsSync(DESTINO)?fs.readFileSync(DESTINO,'utf8'):null;
const sinCr=(t)=>t.replace(/\r\n/g,'\n');
if(actual===null||sinCr(actual)!==sinCr(nuevo)){
  const eol=actual&&actual.includes('\r\n')?'\r\n':'\n';
  fs.writeFileSync(DESTINO,sinCr(nuevo).replace(/\n/g,eol));
}
