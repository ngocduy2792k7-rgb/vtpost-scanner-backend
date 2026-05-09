const db = require('./db');
async function check() {
  try {
    const [rows] = await db.execute('SELECT tracking_code FROM shipments LIMIT 10');
    console.log('Sample Tracking Codes:');
    rows.forEach(r => console.log(`- ${r.tracking_code}`));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
check();
