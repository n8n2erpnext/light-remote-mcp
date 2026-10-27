// One-time, idempotent migration of previously sent native system acknowledgments.
// Run explicitly inside the Gate container after snapshotting; never logs message text or codes.
import pg from 'pg';
import {makeBridgeURL} from './public-ticket.mjs';

const url=process.env.GATE_PG_URL;
if(!url)throw Error('gate_postgres_required');
const gate=new pg.Pool({connectionString:url,max:2});
const bridge=new pg.Pool({connectionString:makeBridgeURL(url),max:2,statement_timeout:8000});
try{
 await gate.query('CREATE TABLE IF NOT EXISTS support_gate_ticket_system_messages (conversation_uuid uuid NOT NULL,native_message_id bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(conversation_uuid,native_message_id))');
 // Match only recognizable native automatic acknowledgment formats, never arbitrary support notes.
 const result=await bridge.query(
  "SELECT t.uuid AS conversation_uuid,m.id AS native_message_id "+
  "FROM support_bridge.public_message m JOIN support_bridge.ticket t ON t.id=m.conversation_id "+
  "WHERE t.inbox_id IN (1,2) AND m.type='outgoing' AND ("+
  "(m.text_content ILIKE $1 AND m.text_content ILIKE $2) OR "+
  "(m.text_content ILIKE $3 AND m.text_content ILIKE $4) OR "+
  "(m.text_content ILIKE $5 AND m.text_content ILIKE $6))",
  ['%Your ticket access code:%','%Open your private ticket%',
   '%Your Support Center ticket access code is:%','%Use this code together%',
   '%View ticket #%','%If the button does not work%']);
 if(result.rows.length>5000)throw Error('system_message_backfill_size_unexpected');
 const client=await gate.connect();let added=0;
 try{
  await client.query('BEGIN');
  for(const item of result.rows){
   const outcome=await client.query('INSERT INTO support_gate_ticket_system_messages(conversation_uuid,native_message_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[item.conversation_uuid,item.native_message_id]);
   added+=outcome.rowCount;
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
 console.log('SYSTEM_MESSAGE_BACKFILL_MATCHED='+result.rows.length);
 console.log('SYSTEM_MESSAGE_BACKFILL_INSERTED='+added);
}finally{await bridge.end();await gate.end()}
