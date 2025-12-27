// scanner.js
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

let scannerPort = null;

async function listSerialPorts() {
  return await SerialPort.list();
}

function stopSerialScanner() {
  try {
    if (scannerPort?.isOpen) {
      scannerPort.removeAllListeners();
      scannerPort.close();
    }
  } catch (e) {
    console.error('Error cerrando scannerPort:', e);
  } finally {
    scannerPort = null;
  }
}

function startSerialScanner(win, { path, baudRate = 9600, delimiter = '\r\n' } = {}) {
  try {
    stopSerialScanner();

    if (!path) {
      console.log('ℹ️ Scanner: sin puerto seleccionado, no se inicia.');
      return;
    }

    scannerPort = new SerialPort({ path, baudRate, autoOpen: true });

    const parser = scannerPort.pipe(new ReadlineParser({ delimiter }));

    parser.on('data', (line) => {
      const code = String(line || '').trim();
      if (!code) return;
      win.webContents.send('barcode-scan', { code });
    });

    scannerPort.on('open', () => console.log(`✅ Scanner serial iniciado en ${path} @${baudRate}`));
    scannerPort.on('error', (e) => console.error('Scanner serial error:', e));
  } catch (e) {
    console.error('No se pudo iniciar scanner serial:', e);
  }
}

module.exports = { startSerialScanner, stopSerialScanner, listSerialPorts };
