const sql = require("mssql");

let sqlPool;

/**
 * Devuelve un pool de conexión a SQL Server (Bit2), reutilizándolo entre
 * peticiones. Lee las credenciales de variables de entorno.
 */
async function getSqlPool() {
  if (sqlPool && sqlPool.connected) return sqlPool;
  sqlPool = await sql.connect({
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    port: Number(process.env.SQL_PORT || 1433),
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
  });
  return sqlPool;
}

module.exports = { sql, getSqlPool };
