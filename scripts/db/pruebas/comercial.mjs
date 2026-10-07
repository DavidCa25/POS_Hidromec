import {readFileSync} from 'node:fs';
import {restaurar,eliminar} from '../lib/temporal.mjs';
import {consultarTemporal,enParalelo} from '../lib/temporal-consulta.mjs';
import assert from 'node:assert/strict';
const DB='Wybix_TmpComercial';
const q=s=>{const r=consultarTemporal(DB,s);if(!r.ok)throw Error(r.error);return r.sets[0]??[];};
try{
 restaurar(DB,'installer/template.bak');
 for(const batch of readFileSync('electron/migrations/0053_comercial.sql','utf8').split(/^\s*GO\s*$/im))if(batch.trim())q(batch);
 // Idempotencia de la migración nueva, sin reejecutar las otras 52 del baseline.
 for(const batch of readFileSync('electron/migrations/0053_comercial.sql','utf8').split(/^\s*GO\s*$/im))if(batch.trim())q(batch);
 q("INSERT dbo.users(usuario,password_hash,rol,active,creation_date) VALUES(N'qa-comercial',N'x',N'admin',1,GETDATE());INSERT dbo.CAT_brands(namee) VALUES(N'QA');INSERT dbo.CAT_categories(namee) VALUES(N'QA');");
 const user=q("SELECT id FROM dbo.users WHERE usuario=N'qa-comercial'")[0].id;
 const brand=q("SELECT id FROM dbo.CAT_brands WHERE namee=N'QA'")[0].id,category=q("SELECT id FROM dbo.CAT_categories WHERE namee=N'QA'")[0].id;
 const product=q(`EXEC dbo.sp_add_product @brand=${brand},@part_number=N'QA-COM',@name=N'Dona QA',@price=25,@stock=100,@category=${category},@cost=5`)[0].id;
 q(`EXEC dbo.sp_open_shift @user_id=${user},@opening_cash=0,@register_id=1;`);
 const quote='10000000-0000-4000-8000-000000000001';const payload=JSON.stringify({channel:'UBER',version:0,lines:[{line_no:1,productId:product,qty:2,unitPrice:32,options:[],audit:{basePrice:'32.00',discount:'0.00',rule:null}}],catalog:[{id:product,price:25}]});
 q(`INSERT dbo.commercial_quotes(id,actor_id,register_id,policy_version,payload,expires_at) VALUES('${quote}',${user},1,0,N'${payload}',DATEADD(minute,5,SYSUTCDATETIME()))`);
 // Más de una cotización pendiente debe ser posible (NULL no es único en SQL Server).
 q(`INSERT dbo.commercial_quotes(id,actor_id,register_id,policy_version,payload,expires_at) VALUES('10000000-0000-4000-8000-000000000002',${user},1,0,N'${payload}',DATEADD(minute,5,SYSUTCDATETIME()))`);
 const sell=(price=32,id=quote)=>`DECLARE @a dbo.SaleDetailType,@b dbo.SaleDetailType2,@m dbo.SaleModifierType;INSERT @b VALUES(1,${product},2,${price},NULL);EXEC dbo.sp_register_sale @user_id=${user},@payment_method=N'TARJETA',@register_id=1,@SaleDetails=@a,@SaleDetails2=@b,@SaleModifiers=@m,@commercial_quote='${id}';`;
 assert.equal(consultarTemporal(DB,sell(1)).ok,false,'rechaza precio alterado');
 const sale=q(sell())[0];assert.equal(Number(sale.total),64);assert.equal(Number(q(`SELECT stock FROM dbo.products WHERE id=${product}`)[0].stock),98);
 assert.equal(consultarTemporal(DB,sell()).ok,false,'no duplica una cotización usada');
 assert.equal(q(`SELECT commercial_snapshot FROM dbo.sales WHERE id=${sale.sale_id}`)[0].commercial_snapshot!==null,true);
 q('UPDATE dbo.commercial_policy SET version=1 WHERE id=1');assert.equal(consultarTemporal(DB,sell(32,'10000000-0000-4000-8000-000000000002')).ok,false,'rechaza política desactualizada');
 assert.equal(Number(q('SELECT COUNT(*) n FROM dbo.sales')[0].n),1);assert.equal(Number(q(`SELECT stock FROM dbo.products WHERE id=${product}`)[0].stock),98);

 const refund=(sale,qty)=>`DECLARE @r dbo.SaleDetailType;INSERT @r VALUES(${product},${qty},0);EXEC dbo.sp_refund_sale @sale_id=${sale},@user_id=${user},@payment_method=N'TARJETA',@RefundDetails=@r,@apply_net_update=0;`;
 assert.equal(Number(q(refund(sale.sale_id,1))[0].refund_total),32);
 assert.equal(Number(q(refund(sale.sale_id,1))[0].refund_total),32);
 assert.equal(consultarTemporal(DB,refund(sale.sale_id,1)).ok,false,'no devuelve más de lo vendido');
 const promotional='10000000-0000-4000-8000-000000000003';
 const deal=JSON.stringify({channel:'LOCAL',version:1,lines:[{line_no:1,productId:product,qty:1,unitPrice:0,options:[],audit:{discount:'25.00',rule:'2x1'}},{line_no:2,productId:product,qty:1,unitPrice:25,options:[],audit:{discount:'0.00',rule:'2x1'}}],catalog:[{id:product,price:25}]});
 q(`INSERT dbo.commercial_quotes(id,actor_id,register_id,policy_version,payload,expires_at) VALUES('${promotional}',${user},1,1,N'${deal}',DATEADD(minute,5,SYSUTCDATETIME()))`);
 const dealSale=q(`DECLARE @a dbo.SaleDetailType,@b dbo.SaleDetailType2,@m dbo.SaleModifierType;INSERT @b VALUES(1,${product},1,0,NULL),(2,${product},1,25,NULL);EXEC dbo.sp_register_sale @user_id=${user},@payment_method=N'TARJETA',@register_id=1,@SaleDetails=@a,@SaleDetails2=@b,@SaleModifiers=@m,@commercial_quote='${promotional}';`)[0];
 assert.equal(Number(dealSale.total),25);
 assert.equal(Number(q(refund(dealSale.sale_id,1))[0].refund_total),12.5);
 assert.equal(Number(q(refund(dealSale.sale_id,1))[0].refund_total),12.5);
 assert.equal(Number(q(`SELECT SUM(refund_total) n FROM dbo.sale_refunds WHERE sale_id=${dealSale.sale_id}`)[0].n),25,'dos devoluciones no devuelven 50 por un 2x1 de 25');
 assert.equal(Number(q(`SELECT stock FROM dbo.products WHERE id=${product}`)[0].stock),100,'todas las unidades se restituyen una sola vez');

 // Dos cajas cotizan el mismo cupón antes de cobrar: solo una confirma.
 const def=q(`INSERT dbo.coupon_definitions(name,kind,product_id,uses_allowed,active) OUTPUT INSERTED.id VALUES(N'QA gratis',N'FREE_PRODUCT',${product},1,1)`)[0].id;
 const coupon=q(`INSERT dbo.coupon_instances(definition_id,code,uses_allowed,expires_at) OUTPUT INSERTED.id VALUES(${def},N'QA-COM-UNICO',1,DATEADD(day,1,SYSDATETIME()))`)[0].id;
 const gift=JSON.stringify({version:1,channel:'LOCAL',coupon:{code:'QA-COM-UNICO',productId:product,instanceId:coupon,amountApplied:'25.00'},lines:[{line_no:1,productId:product,qty:1,unitPrice:0,options:[]},{line_no:2,productId:product,qty:2,unitPrice:25,options:[]}],catalog:[{id:product,price:25}]});
 const ids=['10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005'];
 for(const id of ids)q(`INSERT dbo.commercial_quotes(id,actor_id,register_id,policy_version,payload,expires_at) VALUES('${id}',${user},1,1,N'${gift}',DATEADD(minute,5,SYSUTCDATETIME()))`);
 const giftSell=id=>`DECLARE @a dbo.SaleDetailType,@b dbo.SaleDetailType2,@m dbo.SaleModifierType;INSERT @b VALUES(1,${product},1,0,NULL),(2,${product},2,25,NULL);EXEC dbo.sp_register_sale @user_id=${user},@payment_method=N'PLATAFORMA',@register_id=1,@SaleDetails=@a,@SaleDetails2=@b,@SaleModifiers=@m,@commercial_quote='${id}';`;
 const raced=await enParalelo(DB,ids.map(giftSell));assert.equal(raced.filter(r=>r.ok).length,1,'un cupón no deja dos ventas gratis confirmadas');
 assert.equal(Number(q(`SELECT uses_count FROM dbo.coupon_instances WHERE id=${coupon}`)[0].uses_count),1);
 assert.equal(Number(q(`SELECT stock FROM dbo.products WHERE id=${product}`)[0].stock),97,'el intento perdedor revierte sus tres consumos');
 const giftSale=raced.find(r=>r.ok).sets[0][0].sale_id;
 assert.equal(Number(q(`SELECT total FROM dbo.sales WHERE id=${giftSale}`)[0].total),50,'solo una de tres unidades es gratis');
 assert.equal(q(`EXEC dbo.sp_coupon_redeem @code=N'QA-COM-UNICO',@sale_id=${giftSale},@amount_applied=25`)[0].ok,true,'el canje posterior es idempotente');
 const ctx=JSON.stringify({channel:'LOCAL',lines:[{linea:1,combo:{id:'menu-qa',instance:'qa-instancia',group:'dona'}}]});
 const cuenta=q(`EXEC dbo.sp_hosp_cuenta_abrir @etiqueta=N'Cuenta comercial QA',@user_id=${user};`)[0].id;
 const send=`DECLARE @l dbo.HospOrdenLineaV2Type,@o dbo.HospOrdenOpcionType;INSERT @l VALUES(1,${product},1,NULL,'20000000-0000-4000-8000-000000000001');EXEC dbo.sp_hosp_orden_enviar @cuenta_id=${cuenta},@user_id=${user},@lineas=@l,@opciones=@o,@commercial=N'${ctx}';`;
 q(send);q(send);const loaded=consultarTemporal(DB,`EXEC dbo.sp_hosp_cuenta_get @cuenta_id=${cuenta};`);assert.equal(loaded.ok,true);assert.equal(JSON.parse(loaded.sets[0][0].commercial_context).channel,'LOCAL');assert.equal(loaded.sets[1].length,1);assert.equal(JSON.parse(loaded.sets[1][0].commercial_component).id,'menu-qa','reabrir la cuenta conserva el grupo del combo');
 // Un pago ya aprobado conserva el importe acordado aunque se publique otra lista.
 const frozen='10000000-0000-4000-8000-000000000006';q(`INSERT dbo.commercial_quotes(id,actor_id,register_id,policy_version,payload,expires_at,payment_reference) VALUES('${frozen}',${user},1,0,N'${payload}',DATEADD(minute,-1,SYSUTCDATETIME()),N'QA-POINT-APROBADO')`);
 const external=sell(32,frozen).replace("@payment_method=N'TARJETA'","@payment_method=N'TERMINAL_MP'").replace(';', ";");
 assert.equal(consultarTemporal(DB,external).ok,false,'una reserva de Point no se consume sin verificación');
 const approved=q(external.replace(`@commercial_quote='${frozen}'`,`@commercial_quote='${frozen}',@commercial_payment_reference=N'QA-POINT-APROBADO'`))[0];assert.equal(Number(approved.total),64);
 assert.equal(consultarTemporal(DB,external.replace(`@commercial_quote='${frozen}'`,`@commercial_quote='${frozen}',@commercial_payment_reference=N'QA-POINT-APROBADO'`)).ok,false,'el pago de Point no confirma dos ventas');
 console.log('COMERCIAL_SQL_OK: migración idempotente, precio por canal, inventario compartido, cotización inmutable, reintento sin duplicados, versión y snapshot');
}finally{eliminar(DB);}
