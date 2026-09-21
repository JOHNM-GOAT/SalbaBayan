-- The ME tab now shows the device code as a QR, and Manage roles can scan it
-- (src/components/DeviceQr.tsx, RoleManager.tsx). One new button label.
-- roles.* is officials-only: other machine-translated languages fall back to
-- Tagalog (scripts/generate-translations.mjs).

insert into public.translations (message_key, language, text) values
  ('roles.scan', 'en', 'SCAN QR'),
  ('roles.scan', 'tl', 'I-SCAN ANG QR'),
  ('roles.scan', 'ceb', 'I-SCAN ANG QR'),
  ('roles.scan', 'fil', 'I-SCAN ANG QR'),
  ('roles.scan', 'ilo', 'I-SCAN TI QR')
on conflict (message_key, language) do update set text = excluded.text;
