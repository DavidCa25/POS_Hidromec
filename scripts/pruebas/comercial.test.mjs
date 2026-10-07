import { separarCombosCancelados } from '../../shared/comandas-comerciales.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cotizar,politicaVacia} from '../../shared/comercial.ts';
const products=[{id:'dona',price:'25.00',category:'donas'},{id:'cafe',price:'35.00',category:'bebidas'},{id:'premium',price:'30.00',category:'donas'}];
const ctx={channel:'LOCAL',date:'2026-10-06',time:'09:30',weekday:2};
const line=(product,quantity='1',extras='0')=>({key:product,product,quantity,extras});
const rule=(kind,extra={})=>({id:'promo',name:'Oferta',active:true,priority:1,kind,selector:{products:['dona']},...extra});
function config(r){return {...politicaVacia(),promotions:r?[r]:[]};}
test('sin configuración comercial conserva precios y cantidades decimales',()=>{
 assert.equal(cotizar(config(),products,[line('dona','1.25','3.00')],ctx).total,'35.00');
});
test('un solo producto: canal cambia precio, extras conservados',()=>{
 const p=config();p.channels.push({id:'UBER',name:'Uber',active:true,inheritBase:false});p.prices.push({channel:'UBER',product:'dona',price:'32.00'});
 const q=cotizar(p,products,[line('dona','2','5.00')],{...ctx,channel:'UBER'});assert.equal(q.total,'74.00');assert.equal(q.lines[0].product,'dona');assert.throws(()=>cotizar(p,products,[line('cafe')],{...ctx,channel:'UBER'}),/Falta configurar/);
});
test('promoción del martes: no aplica el miércoles ni en otro canal',()=>{
 const p=config(rule('PRICE',{value:'19.00',weekdays:[2],channels:['LOCAL']}));assert.equal(cotizar(p,products,[line('dona')],ctx).total,'19.00');assert.equal(cotizar(p,products,[line('dona')],{...ctx,weekday:3}).total,'25.00');
});
test('2x1 con dos, tres y cuatro unidades; extras no se regalan',()=>{
 const p=config(rule('BUY_PAY',{buy:2,pay:1}));for(const [n,total]of [['2','25.00'],['3','50.00'],['4','50.00']])assert.equal(cotizar(p,products,[line('dona',n)],ctx).total,total);assert.equal(cotizar(p,products,[line('dona','2','5')],ctx).total,'35.00');
});
test('2x1 de categoría bonifica la unidad de menor precio',()=>{
 const p=config(rule('BUY_PAY',{buy:2,pay:1,selector:{categories:['donas']}}));assert.equal(cotizar(p,products,[line('dona'),line('premium')],ctx).total,'30.00');
});
test('porcentaje no acumulable con 2x1 sobre las mismas unidades',()=>{
 const p=config(rule('BUY_PAY',{buy:2,pay:1}));p.promotions.push(rule('PERCENT',{id:'segundo',priority:2,value:'20.00'}));assert.equal(cotizar(p,products,[line('dona','2')],ctx).total,'25.00');
});
test('porcentaje por elegibilidad; sin confirmación no descuenta',()=>{
 const p=config(rule('PERCENT',{value:'20',audience:'ESTUDIANTE'}));assert.equal(cotizar(p,products,[line('dona')],ctx).total,'25.00');assert.equal(cotizar(p,products,[line('dona')],{...ctx,audiences:['ESTUDIANTE']}).total,'20.00');
});
test('dos donas habilitan café +10, exclusivamente en las dos ventanas',()=>{
 const p=config(rule('ADDON',{selector:{products:['cafe']},trigger:{categories:['donas']},triggerQty:2,value:'10',windows:[{from:'07:30',to:'10:00'},{from:'19:00',to:'21:00'}]}));
 for(const time of ['07:30','09:59','19:00','20:59'])assert.equal(cotizar(p,products,[line('dona','2'),line('cafe')],{...ctx,time}).total,'60.00');
 for(const time of ['07:29','10:00','18:59','21:00'])assert.equal(cotizar(p,products,[line('dona','2'),line('cafe')],{...ctx,time}).total,'85.00');
 assert.equal(cotizar(p,products,[line('dona'),line('cafe')],ctx).total,'60.00');
 assert.equal(cotizar(p,products,[line('dona','2'),line('cafe','2')],ctx).total,'95.00');
});
test('combo: componentes reales, precio exacto, extras y exclusión de ofertas',()=>{
 const p=config(rule('PERCENT',{value:'20',selector:{}}));p.combos=[{id:'desayuno',name:'Dona + café',active:true,price:'59',groups:[{id:'d',name:'Dona',quantity:1,selector:{categories:['donas']}},{id:'c',name:'Café',quantity:1,selector:{products:['cafe']}}]}];
 const cart=[{...line('dona'),combo:{id:'desayuno',instance:'combo-1',group:'d'}},{...line('cafe','1','3'),combo:{id:'desayuno',instance:'combo-1',group:'c'}}];const q=cotizar(p,products,cart,ctx);assert.equal(q.total,'62.00');assert.equal(q.lines.length,2);assert.deepEqual(q.lines.map(l=>l.product),['dona','cafe']);assert.equal(q.lines[0].unitPrice,'24.58');assert.equal(q.lines[1].unitPrice,'37.42');assert.throws(()=>cotizar(p,products,cart.slice(0,1),ctx),/Completa/);
});
test('media docena reparte centavos sin alterar las seis elecciones',()=>{
 const p=config();p.combos=[{id:'media',name:'Media docena',active:true,price:'138',groups:[{id:'donas',name:'Elige seis',quantity:6,selector:{categories:['donas']}}]}];const q=cotizar(p,products,[{...line('dona','5'),combo:{id:'media',instance:'m',group:'donas'}},{...line('premium'),combo:{id:'media',instance:'m',group:'donas'}}],ctx);assert.equal(q.total,'138.00');assert.equal(q.lines.length,6);assert.equal(q.gross,'155.00');assert.equal(q.discount,'17.00');
});
test('rechaza regla inválida, porcentaje >100, selección desconocida y partidas repetidas',()=>{
 assert.throws(()=>cotizar(config(rule('PERCENT',{value:'101'})),products,[line('dona')],ctx),/100%/);assert.throws(()=>cotizar(config(rule('BUY_PAY',{buy:2,pay:2})),products,[line('dona')],ctx),/Compra/);assert.throws(()=>cotizar(config(),products,[line('dona'),line('dona')],ctx),/duplicada/);assert.throws(()=>cotizar(config(),products,[line('inexistente')],ctx),/disponible/);
});
test('partidas fraccionadas no entran en ofertas por unidades',()=>assert.throws(()=>cotizar(config(rule('BUY_PAY',{buy:2,pay:1})),products,[line('dona','1.5')],ctx),/completas/));
test('cupón limitado a una unidad conserva las otras dos y cobra extras',()=>{
 const q=cotizar(config(rule('PRICE',{value:'0',maxApplications:1})),products,[line('dona','3','5')],ctx);assert.equal(q.total,'65.00');assert.equal(q.discount,'25.00');assert.equal(q.lines.filter(l=>l.unitPrice==='5.00').length,1);
});
test('descuento porcentual admite fracciones; no exige unidades por una oferta fuera de horario',()=>{
 assert.equal(cotizar(config(rule('PERCENT',{value:'20'})),products,[line('dona','1.25')],ctx).total,'25.00');
 assert.equal(cotizar(config(rule('BUY_PAY',{buy:2,pay:1,weekdays:[3]})),products,[line('dona','1.25')],ctx).total,'31.25');
});
test('ajuste negativo de tamaño conserva el precio y no crea importes negativos en 2x1',()=>{
 const q=cotizar(config(rule('BUY_PAY',{buy:2,pay:1})),products,[line('dona','2','-2.50')],ctx);assert.equal(q.total,'22.50');assert.equal(q.lines[0].extras,'-2.50');assert.equal(q.lines[0].unitPrice,'0.00');
});
test('redondea una sola vez el total de partidas fraccionadas',()=>{
 const q=cotizar(config(),[{id:'a',price:'0.01'},{id:'b',price:'0.01'}],[line('a','0.25'),line('b','0.25')],ctx);assert.equal(q.total,'0.01');
});

test('cancelar una estación disuelve solo ese combo y el remanente se cobra individualmente',()=>{
 const policy={...config(),combos:[{id:'menu',name:'Menú',active:true,price:'59.00',groups:[{id:'d',name:'Dona',quantity:1,selector:{products:['dona']}},{id:'c',name:'Café',quantity:1,selector:{products:['cafe']}}]}]};
 const a={...line('dona'),key:'d1',combo:{id:'menu',instance:'otro',group:'d'}};
 const b={...line('cafe'),key:'c1',combo:{id:'menu',instance:'otro',group:'c'}};
 const survivor={...line('cafe'),key:'c2',combo:{id:'menu',instance:'cancelado',group:'c'}};
 const result=separarCombosCancelados([a,b,survivor],[{estado:'CANCELADA',commercial_component:JSON.stringify({instance:'cancelado'})}]);
 assert.equal(result.changed,true);assert.equal(result.lines[2].combo,undefined);assert.equal(survivor.combo.instance,'cancelado');
 assert.equal(cotizar(policy,products,result.lines,ctx).total,'94.00');
 assert.equal(separarCombosCancelados([a,b],[]).changed,false);
});
