-- Replace the email below with the account you created at /login.
-- Run in the Supabase SQL editor, never in the browser.
do $$
declare target uuid;
begin
 select id into target from auth.users where lower(email)=lower('REPLACE_WITH_YOUR_EMAIL');
 if target is null then raise exception 'Account not found. Sign up first and replace the email in this script.';end if;
 insert into profiles(id,role) values(target,'admin') on conflict(id) do update set role='admin';
end $$;
