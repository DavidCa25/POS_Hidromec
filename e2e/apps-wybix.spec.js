const { test, expect, CUENTAS, irPorMas } = require('./fixtures');
async function entrar(app, cuenta) {
  const p=app.ventana;
  await p.fill('#username',cuenta.usuario);await p.fill('#password',cuenta.password);await p.click('#btnLogin');
  await p.waitForSelector('.wxdock');
  if (cuenta === CUENTAS.operador) {
    const salir=p.locator('.open-shift-modal').getByRole('button',{name:'Salir',exact:true});
    await salir.click();
    await p.getByRole('link',{name:'Inicio',exact:true}).click();
    await p.waitForSelector('app-inicio');
  }
}
test('Apps: descarga de las dos apps, pasos separados, foco y paridad de navegación',async({app},testInfo)=>{
 const p=app.ventana;await entrar(app,CUENTAS.admin);
 await p.getByRole('button',{name:'Apps Wybix',exact:true}).click();
 const dialog=p.getByRole('dialog',{name:'Apps Wybix',exact:true});await expect(dialog).toBeVisible();
 await p.screenshot({path:testInfo.outputPath('apps-menu.png')});
 for (const width of [1024,640]) {
   await p.setViewportSize({width,height:800});
   await expect.poll(()=>p.locator('.apps__panel').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
 }
 await p.setViewportSize({width:1366,height:900});
 await dialog.getByRole('button',{name:/Wybix Owner/}).click();
 await expect(p.locator('.apps__qr img')).toBeVisible();
 await expect(p.getByRole('link',{name:'Descargar APK',exact:true})).toHaveAttribute('href',/app-download\?app=owner$/);
 await p.getByRole('button',{name:'iPhone / iPad · Web',exact:true}).click();await expect(p.getByRole('link',{name:'Abrir versión web',exact:true})).toHaveAttribute('href',/app=owner&platform=web$/);await expect(p.locator('.apps__panel')).toContainText('Agregar a pantalla de inicio');await p.getByRole('button',{name:'2 · Vincular negocio'}).click();await expect(p.locator('app-pairing-qr')).toBeVisible();
 await p.getByRole('button',{name:'Apps Wybix',exact:true}).last().click();
 await p.getByRole('button',{name:/Wybix POS Mobile/}).click();
 await p.getByRole('button',{name:'Android',exact:true}).click();await expect(p.locator('.apps__qr img')).toBeVisible();await expect(p.getByRole('link',{name:'Descargar APK',exact:true})).toHaveAttribute('href',/app-download\?app=mobile$/);
 await p.getByRole('button',{name:'iPhone / iPad · Web',exact:true}).click();await expect(p.getByRole('link',{name:'Abrir versión web',exact:true})).toHaveAttribute('href',/app=mobile&platform=web$/);await p.getByRole('button',{name:'2 · Vincular negocio'}).click();await expect(p.locator('.apps__lista')).toContainText('Agregar tablet');
 await p.keyboard.press('Escape');await expect(p.locator('.apps__panel')).toHaveCount(0);await expect(p.locator('.wxdock__btn--apps')).toBeFocused();
 await irPorMas(p,'Configuracion');await expect(p.locator('app-config-shell')).toBeVisible();
 await expect(p.locator('app-config-shell')).not.toContainText('Emparejamiento QR');await expect(p.locator('app-config-shell')).not.toContainText('Descarga la app movil');
 await expect(p.locator('app-config-shell')).toContainText('Sincronización en la nube');
 await p.click('.wxmodo.es-dock');await p.waitForSelector('.wxside');
 await p.getByRole('button',{name:'Apps Wybix',exact:true}).click();await expect(p.locator('.apps__panel')).toBeVisible();
 await p.keyboard.press('Escape');await expect(p.getByRole('button',{name:'Apps Wybix',exact:true})).toBeFocused();
});
test('una cajera puede descargar, pero no generar invitaciones de Owner',async({app})=>{
 const p=app.ventana;await entrar(app,CUENTAS.operador);await p.getByRole('button',{name:'Apps Wybix',exact:true}).click();await p.getByRole('button',{name:/Wybix Owner/}).click();await expect(p.locator('.apps__qr img')).toBeVisible();await p.getByRole('button',{name:'2 · Vincular negocio'}).click();await expect(p.locator('.apps__panel')).toContainText('Pide a un administrador');await expect(p.locator('app-pairing-qr')).toHaveCount(0);
});
