-- Support Gate public ticket bridge: read-only view + one narrowly scoped contact-message insert.
-- Run on Libredesk's local database, never grant direct table writes to Gate.
BEGIN;
CREATE OR REPLACE VIEW support_bridge.ticket AS
 SELECT c.id,c.uuid,c.inbox_id,c.reference_number,c.subject,c.created_at,c.updated_at,
        c.status_id,u.email AS contact_email,i.name AS inbox_name,
        c.closed_at,st.name AS status_name
 FROM public.conversations c
 JOIN public.users u ON u.id=c.contact_id
 JOIN public.inboxes i ON i.id=c.inbox_id AND i.deleted_at IS NULL
 JOIN public.conversation_statuses st ON st.id=c.status_id
 WHERE c.inbox_id IN (1,2) AND i.channel='email' AND i.enabled=true;
GRANT SELECT ON support_bridge.ticket TO support_gate;
CREATE OR REPLACE FUNCTION support_bridge.add_web_reply(p_uuid uuid,p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,support_bridge
AS $func$
DECLARE
 c record; out_uuid uuid; msg text;
BEGIN
 msg:=btrim(p_body);
 IF msg IS NULL OR length(msg)<1 OR length(msg)>4000 THEN
  RAISE EXCEPTION 'invalid_reply';
 END IF;
 SELECT x.id,x.inbox_id,x.contact_id,x.status_id,x.uuid,ix.channel,ix.enabled
 INTO c
 FROM public.conversations x JOIN public.inboxes ix ON ix.id=x.inbox_id
 WHERE x.uuid=p_uuid AND x.inbox_id IN (1,2)
 FOR UPDATE OF x;
 IF NOT FOUND OR c.channel<>'email' OR NOT c.enabled OR c.status_id=4 THEN
  RAISE EXCEPTION 'ticket_not_open_to_replies';
 END IF;
 INSERT INTO public.conversation_messages
 (type,status,private,conversation_id,content_type,content,text_content,sender_id,sender_type,meta)
 VALUES ('incoming','received',false,c.id,'text',msg,msg,c.contact_id,'contact',
         '{"source":"public_ticket_web"}'::jsonb)
 RETURNING uuid INTO out_uuid;
 UPDATE public.conversations
 SET updated_at=now(),last_message=left(msg,500),last_message_sender='contact',
 last_message_at=now(),last_interaction=left(msg,500),last_interaction_sender='contact',
 last_interaction_at=now(),last_inbound_at=now(),
 status_id=CASE WHEN status_id IN (2,3) THEN 1 ELSE status_id END,
 waiting_since=null
 WHERE id=c.id;
 RETURN out_uuid;
END;
$func$;
REVOKE ALL ON FUNCTION support_bridge.add_web_reply(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_bridge.add_web_reply(uuid,text) TO support_gate;
COMMIT;
