const sql = require('mssql');

// Configura tu conexión:
const config = {
    user: 'Casillas3',
    password: 'Casillas00!',
    server: 'localhost', 
    database: 'FiYLubRiosII',
    port: 1433,
    options: {
        encrypt: false, 
        trustServerCertificate: true 
    }
};

// Conectar
const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('✅ Conexión a SQL Server establecida');
        return pool;
    })
    .catch(err => {
        console.error('❌ Error en la conexión a SQL Server', err);
    });

module.exports = {
    sql, poolPromise
};
