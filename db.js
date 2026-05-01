const { Pool } = require("pg");
const connectionString = process.env.postgresql://healthcare_5vp2_user:Ql9hAvkuKls918KZP5ktW0vkTvHykyqX@dpg-d7f5q8q8qa3s73fnrh6g-a/healthcare_5vp2;
if (!connectionString) throw new Error("DATABASE_URL is not set");
module.exports = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
