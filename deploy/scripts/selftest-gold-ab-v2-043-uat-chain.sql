-- Synthetic records ONLY, inside disposable no-network PostgreSQL 17.
-- Created from real Gold UAT 039 --schema-only and migrations 040-043.
BEGIN;
INSERT INTO lr_accounts(account_id,email,plan,status)
 VALUES('p43-chain-owner','p43-chain-owner@example.invalid','vip','active'),
 ('p43-chain-other','p43-chain-other@example.invalid','free','active');
INSERT INTO lr_devices(device_id,owner_account_id,state)
 VALUES('p43-chain-device','p43-chain-owner','online'),
 ('p43-chain-other-device','p43-chain-other','online');
INSERT INTO lr_gold_device_short_ids(short_id,device_id)
 VALUES('ABC123','p43-chain-device'),('BCD234','p43-chain-other-device');
DO $$
DECLARE n integer; blocked boolean;
BEGIN
 SELECT count(*) INTO n
 FROM lr_gold_device_short_ids s JOIN lr_devices d ON d.device_id=s.device_id
 WHERE d.owner_account_id='p43-chain-owner' AND s.device_id='p43-chain-device';
 IF n<>1 THEN RAISE EXCEPTION 'owner short ID not visible'; END IF;
 SELECT count(*) INTO n
 FROM lr_gold_device_short_ids s JOIN lr_devices d ON d.device_id=s.device_id
 WHERE d.owner_account_id='p43-chain-other' AND s.device_id='p43-chain-device';
 IF n<>0 THEN RAISE EXCEPTION 'foreign owner short ID leaked'; END IF;
 blocked:=FALSE;
 BEGIN
   UPDATE lr_gold_device_short_ids SET short_id='CCC456'
   WHERE device_id='p43-chain-device';
 EXCEPTION WHEN check_violation THEN blocked:=TRUE;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Short ID mutable'; END IF;
 blocked:=FALSE;
 BEGIN
  UPDATE lr_gold_device_short_ids SET device_id='p43-chain-other-device'
  WHERE device_id='p43-chain-device';
 EXCEPTION WHEN check_violation THEN blocked:=TRUE;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Short ID transferred'; END IF;
 IF NOT has_table_privilege('lr_gold_app','public.lr_gold_device_short_ids','SELECT')
    OR NOT has_table_privilege('lr_gold_app','public.lr_gold_device_short_ids','INSERT')
    OR has_table_privilege('lr_gold_app','public.lr_gold_device_short_ids','UPDATE')
 THEN RAISE EXCEPTION 'app Short ID table privileges invalid';END IF;
 IF to_regclass('public.lr_gold_device_gc_fences') IS NULL OR
    to_regclass('public.lr_gold_device_execution_epochs') IS NULL OR
    to_regclass('public.lr_gold_execution_command_issuance') IS NULL OR
    to_regclass('public.lr_gold_device_execution_inventory_pages') IS NULL OR
    to_regclass('public.lr_gold_execution_effect_starts') IS NULL
 THEN RAISE EXCEPTION '040/041 migration chain incomplete';END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conrelid='public.lr_site_announcements'::regclass
   AND conname='lr_site_announcements_audience_check'
   AND pg_get_constraintdef(oid) LIKE '%''wall''%'
 ) THEN RAISE EXCEPTION '042 Wall audience change missing';END IF;
 IF to_regclass('public.lr_gold_pro_share_guest_jobs') IS NOT NULL
 THEN RAISE EXCEPTION 'Guest 044 unexpectedly installed';END IF;
END $$;
-- A device retirement must never permit repurposing the old Short ID.
DELETE FROM lr_devices WHERE device_id='p43-chain-device';
DO $$
DECLARE n integer; blocked boolean:=FALSE;
BEGIN
 SELECT count(*) INTO n FROM lr_gold_device_short_ids
 WHERE short_id='ABC123' AND device_id IS NULL;
 IF n<>1 THEN RAISE EXCEPTION 'Short ID tombstone not retained';END IF;
 BEGIN
  UPDATE lr_gold_device_short_ids SET device_id='p43-chain-other-device'
  WHERE short_id='ABC123';
 EXCEPTION WHEN check_violation THEN blocked:=TRUE;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Short ID tombstone reused';END IF;
END $$;
ROLLBACK;
SELECT 'GOLD_ABV2_NATIVE_039_TO_043_OWNER_SCOPE_IMMUTABLE_TOMBSTONE=PASS';
