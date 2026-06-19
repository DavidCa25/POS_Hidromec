const sql = require('mssql/msnodesqlv8');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getConfigPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'db-config.json');
}

function buildServerName(host, instance) {
  const h = String(host || 'localhost').trim();
  const inst = String(instance || '').trim();
  return inst ? `${h}\\${inst}` : h;
}

const defaultConfig = {
  server: buildServerName(process.env.DB_HOST, process.env.DB_INSTANCE),
  database: process.env.DB_NAME || 'Hidromec_DataBase',
  options: {
    trustedConnection: true, 
    encrypt: String(process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
    trustServerCertificate:
      String(process.env.DB_TRUST_SERVER_CERT || 'true').toLowerCase() === 'true',
    enableArithAbort: true
  }
};

function loadConfig() {
  const configPath = getConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const userCfg = JSON.parse(raw);

      const merged = {
        ...defaultConfig,
        ...userCfg,
        server: userCfg.server || defaultConfig.server,
        database: userCfg.database || defaultConfig.database,
        options: {
          ...defaultConfig.options,
          ...(userCfg.options || {}),
          trustedConnection: true 
        }
      };

      delete merged.user;
      delete merged.password;

      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
      console.log('Configuración de BD cargada desde:', configPath);
      return merged;
    }

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log('Archivo de configuración creado en:', configPath);
    return defaultConfig;
  } catch (err) {
    console.error('Error cargando configuración:', err);

    try {
      if (fs.existsSync(configPath)) fs.renameSync(configPath, `${configPath}.bak`);
    } catch {}

    return defaultConfig;
  }
}

const dbConfig = loadConfig();

const poolPromise = new sql.ConnectionPool(dbConfig)
  .connect()
  .then(pool => {
    console.log('Conectado a SQL Server (Windows Auth). DB:', dbConfig.database, 'Server:', dbConfig.server);
    return pool;
  })
  .catch(err => {
    console.error('Error conectando a la base de datos:', err);
    throw err;
  });

module.exports = {
  sql,
  poolPromise
};
