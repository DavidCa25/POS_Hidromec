const sql = require('mssql');

// Configura tu conexión:
const config = {
    user: 'Luna1211',
    password: 'Baner_Luna24!',
    server: 'localhost', 
    database: 'PointOfSales',
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
