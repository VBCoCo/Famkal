-- STOP: apply only after dashboard Auth settings and end-to-end link tests pass.
-- The operator must explicitly attest within the SAME migration transaction:
-- select set_config('famkal.auth_config_verified','yes',true);
do $$begin
 if current_setting('famkal.auth_config_verified',true) is distinct from 'yes' then
  raise exception 'Verify disabled signup, minimum password length 12 and OTP expiry <=3600 in RC Apple before activation';
 end if;
end $$;
revoke execute on function public.create_family(text),private.create_family(text),public.create_family_invitation(text),private.create_family_invitation(text) from authenticated;
update private.family_access_config set enabled=true where singleton;
