// Explicit Gold-only live data plane verification. No migration/DDL, no secrets in output.
// Must be run only after approved database provisioning on an isolated target.
import {openGoldDataPlane} from '../../platform-v2/src/storage/gold-data-plane.mjs';
let plane;
try{
  plane=await openGoldDataPlane();
  process.stdout.write(JSON.stringify({
    ok:true,engine:'PostgreSQL 17 / Redis 8',
    database:plane.postgres.database,role:plane.postgres.role,
    schemaVersion:plane.postgres.schemaVersion,
    cachePrefix:plane.cache.prefix,redisAuthoritative:false,
    customerDataRead:false,migrationPerformed:false
  })+'\n');
}catch(error){
  process.stderr.write('gold_live_data_plane_not_ready: '+String(error?.cause?.message||error?.message||'unknown').replace(/:\/\/[^@]+@/g,'://[redacted]@')+'\n');
  process.exitCode=2;
}finally{
  await plane?.close();
}
