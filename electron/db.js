const sql = require('mssql');

const config = {
    user: 'Casillas3',
    password: 'Casillas00!',
    server: '8.tcp.ngrok.io', 
    database: 'Hidromec_DataBase',
    port: 13779,
    options: {
        encrypt: false, 
        trustServerCertificate: true 
    }
};

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
