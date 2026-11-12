import { separarCombosCancelados } from '../../shared/comandas-comerciales.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cotizar,politicaVacia} from '../../shared/comercial.ts';
const products=[{id:'dona',price:'25.00',category:'donas'},{id:'cafe',price:'35.00',category:'bebidas'},{id:'premium',price:'30.00',category:'donas'}];
const ctx={channel:'LOCAL',date:'2026-10-06',time:'09:30',weekday:2};
const line=(product,quantity='1',extras='0')=>({key:product,product,quantity,extras});
const rule=(kind,extra={})=>({id:'promo',name:'Oferta',active:true,priority:1,kind,selector:{products:['dona']},...extra});
function config(r){return {...politicaVacia(),promotions:r?[r]:[]};}
test('mayoreo requiere mínimo, mezcla sabores y vuelve al precio normal al quitar piezas',()=>{
 const p=config(rule('VOLUME',{minimumQty:6,mixProducts:true,value:'20',selector:{categories:['donas']}}));
 assert.equal(cotizar(p,products,[line('dona','3'),line('premium','2')],ctx).total,'135.00');
 assert.equal(cotizar(p,products,[line('dona','3'),line('premium','3')],ctx).total,'120.00');
 assert.equal(cotizar(p,products,[line('dona','1')],ctx).total,'25.00');
 p.promotions[0].mixProducts=false;
 assert.equal(cotizar(p,products,[line('dona','3'),line('premium','3')],ctx).total,'165.00');
 assert.equal(cotizar(p,products,[line('dona','6'),line('premium','1')],ctx).total,'150.00');
});
test('mayoreo respeta prioridad, extras y no duplica descuentos',()=>{
 const volume=rule('VOLUME',{minimumQty:2,value:'20'});
 const p=config(volume);p.promotions.push(rule('PERCENT',{id:'estudiante',priority:2,value:'20'}));
 assert.equal(cotizar(p,products,[line('dona','2','5')],ctx).total,'50.00');
 p.promotions[1].priority=0;
 const q=cotizar(p,products,[line('dona','2')],ctx);assert.equal(q.total,'40.00');assert.ok(q.lines.every(x=>x.rule==='estudiante'));
 assert.throws(()=>cotizar(config({...volume,minimumQty:1}),products,[line('dona')],ctx),/Mayoreo inválido/);
 assert.throws(()=>cotizar(config(volume),products,[line('dona','1.5')],ctx),/completas/);
});
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
test('precio por cantidad en paquetes: arma la combinación más barata y el resto va suelto',()=>{
 const glaze=[{id:'glaze',price:'29.00',category:'donas'},{id:'cob',price:'32.00',category:'donas'},{id:'cafe',price:'35.00',category:'bebidas'}];
 const p=config({id:'paq',name:'Docena y media',active:true,priority:1,kind:'VOLUME',selector:{categories:['donas']},tiers:[{qty:12,price:'225.00'},{qty:6,price:'123.00'}]});
 assert.equal(cotizar(p,glaze,[line('glaze','5')],ctx).total,'145.00','5 sueltas');
 assert.equal(cotizar(p,glaze,[line('glaze','6')],ctx).total,'123.00','media docena');
 assert.equal(cotizar(p,glaze,[line('glaze','7')],ctx).total,'152.00','media docena + 1 suelta');
 assert.equal(cotizar(p,glaze,[line('glaze','12')],ctx).total,'225.00','docena, no dos medias');
 assert.equal(cotizar(p,glaze,[line('glaze','18')],ctx).total,'348.00','docena + media');
 // Mezcla: las caras entran al paquete y la barata queda suelta.
 assert.equal(cotizar(p,glaze,[line('glaze','1'),line('cob','6')],ctx).total,'152.00');
 const q=cotizar(p,glaze,[line('glaze','6'),line('cafe','1')],ctx);
 assert.equal(q.total,'158.00','el café no entra');
 assert.equal(q.lines.filter(l=>l.rule==='paq').reduce((a,l)=>a+Number(l.unitPrice),0).toFixed(2),'123.00','el paquete se reparte entre sus piezas');
 assert.throws(()=>cotizar(config({...p.promotions[0],tiers:[{qty:6,price:'1'},{qty:6,price:'2'}]}),glaze,[line('glaze')],ctx),/sin repetir/);
 assert.throws(()=>cotizar(config({...p.promotions[0],minimumQty:6}),glaze,[line('glaze')],ctx),/Paquetes inválidos/);
});
test('combo automático: se arma solo con las piezas, solo si ahorra, y también a mano',()=>{
 const combo={id:'cd',name:'Café + dona',active:true,price:'58.00',auto:true,groups:[{id:'c',name:'Café',quantity:1,selector:{products:['cafe']}},{id:'d',name:'Dona',quantity:1,selector:{categories:['donas']}}]};
 const p={...politicaVacia(),combos:[combo]};
 const q=cotizar(p,products,[line('cafe'),line('dona')],ctx);
 assert.equal(q.total,'58.00');assert.ok(q.lines.every(l=>l.rule==='cd'&&l.combo==='auto-cd-1'));
 assert.equal(cotizar(p,products,[line('cafe','2'),line('dona','3')],ctx).total,'141.00','dos combos + una dona suelta');
 assert.equal(cotizar(p,products,[line('dona','2')],ctx).total,'50.00','sin café no hay combo');
 assert.equal(cotizar({...p,combos:[{...combo,auto:false}]},products,[line('cafe'),line('dona')],ctx).total,'60.00','sin «aplicar solo» se cobra suelto');
 assert.equal(cotizar({...p,combos:[{...combo,price:'60.00'}]},products,[line('cafe'),line('dona')],ctx).lines[0].rule,null,'no se arma si no ahorra');
 // Gana lo más barato para el cliente: la dona a $19 del día + café suelto ($54) contra el combo ($58).
 const dia={...p,promotions:[{id:'dia',name:'Dona del día',active:true,priority:1,kind:'PRICE',selector:{products:['dona']},value:'19.00'}]};
 assert.equal(cotizar(dia,products,[line('cafe'),line('dona')],ctx).total,'54.00');
 // A mano sigue funcionando y no se duplica.
 const mano=[{key:'a',product:'cafe',quantity:'1',extras:'0',combo:{id:'cd',instance:'x',group:'c'}},{key:'b',product:'dona',quantity:'1',extras:'0',combo:{id:'cd',instance:'x',group:'d'}}];
 assert.equal(cotizar(p,products,mano,ctx).total,'58.00');
});
