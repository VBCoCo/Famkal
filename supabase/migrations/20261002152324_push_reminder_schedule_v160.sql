-- Only the database scheduler can read its credential and invoke the worker.
create function private.invoke_push_scheduler() returns bigint language sql security definer set search_path='' as $$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='famkal_push_url'),
  headers:=jsonb_build_object('Content-Type','application/json','x-famkal-cron',(select decrypted_secret::jsonb->>'cronSecret' from vault.decrypted_secrets where name='famkal_push_config')),
  body:='{"action":"drain"}'::jsonb,
  timeout_milliseconds:=120000
 )
$$;
revoke all on function private.invoke_push_scheduler() from public,anon,authenticated,service_role;
select cron.schedule('famkal-send-reminders','* * * * *','select private.invoke_push_scheduler();');
