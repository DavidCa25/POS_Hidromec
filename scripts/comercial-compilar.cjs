const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync('shared/comercial.ts','utf8');
const out=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
fs.mkdirSync('electron/comercial',{recursive:true});
fs.writeFileSync('electron/comercial/motor.cjs','// Generado desde shared/comercial.ts por scripts/comercial-compilar.cjs.\n'+out.outputText);
