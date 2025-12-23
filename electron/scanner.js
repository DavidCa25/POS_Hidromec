const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

let scannerPort = null;

function startSerialScanner(win, { path = 'COM3', baudRate = 9600 } = {}) {
  try {
    scannerPort = new SerialPort({ path, baudRate, autoOpen: true });
    const parser = scannerPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    parser.on('data', (line) => {
      const code = String(line || '').trim();
      if (!code) return;
      win.webContents.send('barcode-scan', { code });
    });

    scannerPort.on('error', (e) => console.error('Scanner serial error:', e));
  } catch (e) {
    console.error('No se pudo iniciar scanner serial:', e);
  }
}

module.exports = { startSerialScanner };
