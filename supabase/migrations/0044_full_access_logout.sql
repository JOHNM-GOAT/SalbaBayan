-- ---------------------------------------------------------------------------
-- Log out of full access
-- ---------------------------------------------------------------------------
-- A device given full access by the access code (0042) can give it up: it
-- becomes a resident's again, and only the access code brings it back.
-- Security definer because the guard on user_roles (0042) refuses any change
-- to a full-access row from a device's own session.

create or replace function public.leave_full_access()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_super() then
    raise exception 'this device does not have full access' using errcode = '42501';
  end if;
  update public.user_roles
     set role = 'resident', is_super = false, granted_at = now()
   where user_id = auth.uid();
end;
$$;

revoke execute on function public.leave_full_access() from public, anon;
grant execute on function public.leave_full_access() to authenticated;

insert into public.translations (message_key, language, text) values
  ('dash.menu', 'en', 'MENU'),
  ('dash.menu', 'tl', 'MENU'),
  ('dash.menu', 'ceb', 'MENU'),
  ('dash.menu', 'fil', 'MENU'),
  ('dash.menu', 'ilo', 'MENU'),

  ('acc.logout_hint', 'en', 'Press and hold — this phone goes back to a resident''s. The access code brings it back.'),
  ('acc.logout_hint', 'tl', 'Pindutin nang matagal — babalik sa residente ang teleponong ito. Maibabalik ito ng access code.'),
  ('acc.logout_hint', 'ceb', 'Pindota ug dugay — mobalik sa residente kining telepono. Mabalik kini sa access code.'),
  ('acc.logout_hint', 'fil', 'Pindutin nang matagal — babalik sa residente ang teleponong ito. Maibabalik ito ng access code.'),
  ('acc.logout_hint', 'ilo', 'Ipindot a nabayag — agsubli iti agnanaed daytoy a telepono. Maisubli daytoy ti access code.')
on conflict (message_key, language) do update set text = excluded.text;
