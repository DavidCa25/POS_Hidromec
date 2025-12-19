const sql = require('mssql');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getConfigPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'db-config.json');
}

const defaultConfig = {
  user: 'Casillas3',
  password: 'Casillas00!',
  server: '6.tcp.us-cal-1.ngrok.io',
  port: 13570,
  database: 'Hidromec_DataBase',
  options: {
    encrypt: true,
    trustServerCertificate: true,
    enableArithAbort: true
  }
};

function loadConfig() {
  const configPath = getConfigPath();
  
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      console.log('Configuración de BD cargada desde:', configPath);
      return config;
    } else {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log('Archivo de configuración creado en:', configPath);
      return defaultConfig;
    }
  } catch (err) {
    console.error('Error cargando configuración:', err);
    return defaultConfig;
  }
}

const dbConfig = loadConfig();

const poolPromise = new sql.ConnectionPool(dbConfig)
  .connect()
  .then(pool => {
    console.log('Conectado a SQL Server');
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