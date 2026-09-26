/**
 * LA RED LOCAL DE WYBIX, Y POR SEPARADO, INTERNET.
 *
 * Son dos preguntas distintas y la pantalla las contesta por separado:
 *
 *   Red local Wybix   ¿las tablets pueden llegar a esta computadora?
 *                     Depende de que haya una interfaz LAN con IP privada.
 *   Internet          ¿hay salida al exterior? Para el Local Host da igual:
 *                     un router sin WAN es una instalacion valida.
 *
 * Esta parte no depende de Electron: se puede probar con interfaces falsas.
 */
const os = require('os');
const http = require('http');
const dns = require('dns');

/* Adaptadores que no son la red del negocio: virtuales, VPN, puentes. Por
   nombre, porque Windows no da otra señal fiable. */
const VIRTUAL = /(vethernet|virtualbox|vmware|hyper-v|wsl|docker|tailscale|zerotier|hamachi|vpn|wireguard|tap-|tun|loopback|bluetooth|npcap|pseudo)/i;
const WIFI = /(wi-?fi|wireless|wlan|inal[aá]mbrica)/i;

/** 10/8, 172.16/12, 192.168/16: las unicas que se anuncian a una tablet. */
function esPrivada(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (p[0] === 10) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  return false;
}

/**
 * Las direcciones por las que una tablet puede llegar. Nunca 127.0.0.1 ni
 * 169.254.x (sin DHCP). Ordenadas: Ethernet primero (la PC principal suele ir
 * por cable), luego Wi-Fi, luego el resto.
 */
function interfacesLan(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [nombre, dirs] of Object.entries(ifaces || {})) {
    if (VIRTUAL.test(nombre)) continue;
    for (const d of dirs || []) {
      const fam = typeof d.family === 'string' ? d.family : (d.family === 4 ? 'IPv4' : 'IPv6');
      if (fam !== 'IPv4' || d.internal) continue;
      if (!esPrivada(d.address)) continue;
      out.push({
        nombre,
        ip: d.address,
        tipo: WIFI.test(nombre) ? 'wifi' : (/ethernet|eth|en\d|lan/i.test(nombre) ? 'ethernet' : 'otra'),
        mascara: d.netmask || null,
      });
    }
  }
  const peso = { ethernet: 0, wifi: 1, otra: 2 };
  return out.sort((a, b) => peso[a.tipo] - peso[b.tipo]);
}

/**
 * ¿Hay Internet? La misma prueba que usa Windows (NCSI): resolver un nombre y
 * leer una pagina conocida, con un limite corto. Un «no» aqui NO es un error
 * para el Local Host.
 */
function hayInternet({ limiteMs = 2500 } = {}) {
  return new Promise((resolve) => {
    let listo = false;
    const fin = (v) => { if (!listo) { listo = true; resolve(v); } };
    const t = setTimeout(() => fin(false), limiteMs);
    dns.lookup('www.msftconnecttest.com', (err) => {
      if (err) { clearTimeout(t); fin(false); return; }
      const req = http.get({ host: 'www.msftconnecttest.com', path: '/connecttest.txt', timeout: limiteMs }, (res) => {
        let cuerpo = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { cuerpo += c; if (cuerpo.length > 200) res.destroy(); });
        res.on('end', () => { clearTimeout(t); fin(/Microsoft Connect Test/.test(cuerpo)); });
      });
      req.on('error', () => { clearTimeout(t); fin(false); });
      req.on('timeout', () => { req.destroy(); clearTimeout(t); fin(false); });
    });
  });
}

module.exports = { interfacesLan, esPrivada, hayInternet };
