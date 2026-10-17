/**
 * Independent Gold Plugin data-plane health admission.
 * In any opt-in PostgreSQL-backed Plugin lane, reject HTTP traffic when
 * PostgreSQL OR Redis goes away. Production/default mode never uses this.
 * This is not a replacement for the 23-domain PG-only acceptance gate.
 */
export function createGoldPluginDependencyGuard({pool,redis}={}){
 if(typeof pool?.query!=='function'||typeof redis?.ping!=='function')
  throw Error('gold_plugin_dependency_guard_requires_verified_plane');
 return async function goldPluginDependencyGuard(_req,res,next){
  try{
   const [db,cache]=await Promise.all([
    pool.query('SELECT 1 AS gold_ready'),redis.ping()
   ]);
   if(Number(db?.rows?.[0]?.gold_ready)!==1||cache!=='PONG')
    throw Error('gold_plugin_dependency_unavailable');
   next();
  }catch{
   if(!res.headersSent)
    res.status(503).set('Cache-Control','no-store').json({
     ok:false,error:'gold_plugin_dependency_unavailable'
    });
   else res.end();
  }
 };
}
