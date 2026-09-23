require('tsx/cjs');
const {migrateProduction}=require('./production-migrate');
migrateProduction().then(()=>{require('../server/src/worker.ts');require('../server/src/server.js');}).catch(error=>{console.error('[vertice-migrate]',error);process.exit(1);});
