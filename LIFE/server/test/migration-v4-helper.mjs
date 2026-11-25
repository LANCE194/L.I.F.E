// Opens the database given on the command line with the app's db.js (running migrations) and
// prints the peak prominence and schema version as JSON. Used by migration.test.js.
process.env.LIFE_DB_PATH = process.argv[2];
process.env.LIFE_SECRET_PATH = `${process.argv[2]}.secret`;
const { initializeDatabase, prepare, closeDatabase } = await import('../db.js');
const silence = console.log;
console.log = () => {};
initializeDatabase();
console.log = silence;
const get = key => prepare('SELECT value FROM settings WHERE key = ?').get(key).value;
console.log(JSON.stringify({ peak_prominence: get('peak_prominence'), schema_version: get('schema_version') }));
closeDatabase();
