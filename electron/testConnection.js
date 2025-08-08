const sql = require('mssql');

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

async function testConnection() {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query('SELECT GETDATE() AS FechaActual');
    console.log('✅ Conexión exitosa. Resultado:');
    console.log(result.recordset);
    sql.close();
  } catch (err) {
    console.error('❌ Error al conectar o ejecutar consulta:', err);
    sql.close();
  }
}

testConnection();
