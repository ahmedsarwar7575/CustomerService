// config/config.cjs
require('dotenv').config();

const common = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  dialect: 'mysql',
  logging: false,
};

module.exports = {
  development: { ...common },
  test:        { ...common },
  production:  { ...common },
};
