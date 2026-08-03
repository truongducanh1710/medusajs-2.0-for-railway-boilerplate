const { Pool } = require('pg');

const pool = new Pool();

pool.query(`
  SELECT COUNT(*) as total_messages,
         COUNT(*) FILTER (WHERE created_at < '2026-07-23'::date) as before_23_jul,
         MIN(created_at) as earliest_message,
         MAX(created_at) as latest_message
  FROM mkt_message
  WHERE channel_id = (SELECT id FROM mkt_channel WHERE name = 'SALE - VẬN ĐƠN')
`, (err, res) => {
  if (err) {
    console.error('Query error:', err);
    process.exit(1);
  }
  console.log('Message counts:', res.rows[0]);
  
  // Query sample messages before 23/7
  pool.query(`
    SELECT id, author_id, content, created_at
    FROM mkt_message
    WHERE channel_id = (SELECT id FROM mkt_channel WHERE name = 'SALE - VẬN ĐƠN')
      AND created_at < '2026-07-23'::date
    ORDER BY created_at DESC
    LIMIT 10
  `, (err2, res2) => {
    if (err2) {
      console.error('Query error:', err2);
    } else {
      console.log('\nSample messages before 23/7:');
      console.table(res2.rows);
    }
    pool.end();
  });
});
