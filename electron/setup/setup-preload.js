const DB_NAME = 'Wybix_POS';

function getInstallConfigPath() {
  return path.join(app.getPath('userData'), 'install-config.json');
}

function loadInstallConfig() {
  const p = getInstallConfigPath();
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('Error leyendo install-config.json:', e);
  }
  return null;
}

function saveInstallConfig(cfg) {
  fs.writeFileSync(getInstallConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupAPI', {
  runSetup: (options) => ipcRenderer.invoke('setup-run', options),
  // Con que cadena se va a conectar Wybix, segun lo que se lleve escrito. La
  // regla vive en el proceso principal: la pantalla la consulta, no la copia.
  normalizarServidor: (texto) => ipcRenderer.invoke('setup-normalizar-servidor', texto),
  activateLicense: (key) => ipcRenderer.invoke('license:activate', key)
});