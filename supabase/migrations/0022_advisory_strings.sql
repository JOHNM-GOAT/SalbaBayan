-- Strings for the official's advisory screen (spec 2026-09-15, §3).
--
-- Worded to match what residents already see, not freshly invented. The hold
-- control uses the SOS control's own verbs ("Press and hold…"), and while it is
-- held it shows `sos.cancelling` ("Release to stop") rather than a new string:
-- the instruction a person needs mid-hold is how to back out, and it is the same
-- for both. The leave-by message says "leave-before" because the field it
-- refers to is labelled with `ui.leave_by`, which reads LEAVE BEFORE.
--
-- The NOT SENT lead reuses the wording of `hazard.pending`, so an unsent change
-- reads the same whether it is a hazard report or the barangay's signal.

insert into public.translations (message_key, language, text) values
  ('off.change_advisory', 'en', 'CHANGE ADVISORY'),
  ('off.change_advisory', 'tl', 'BAGUHIN ANG ABISO'),
  ('off.change_advisory', 'ceb', 'USBA ANG PAHIBALO'),

  ('adv.now', 'en', 'NOW'),
  ('adv.now', 'tl', 'KASALUKUYAN'),
  ('adv.now', 'ceb', 'KARON'),

  ('adv.set', 'en', 'SET'),
  ('adv.set', 'tl', 'ITINAKDA'),
  ('adv.set', 'ceb', 'GITAKDA'),

  ('adv.new_level', 'en', 'NEW LEVEL'),
  ('adv.new_level', 'tl', 'BAGONG ANTAS'),
  ('adv.new_level', 'ceb', 'BAG-ONG LEBEL'),

  ('adv.storm', 'en', 'STORM NAME'),
  ('adv.storm', 'tl', 'PANGALAN NG BAGYO'),
  ('adv.storm', 'ceb', 'NGALAN SA BAGYO'),

  ('adv.bulletin', 'en', 'BULLETIN NO.'),
  ('adv.bulletin', 'tl', 'BULLETIN BLG.'),
  ('adv.bulletin', 'ceb', 'BULLETIN NUM.'),

  ('adv.bulletin_invalid', 'en', 'Bulletin number must be a whole number, 1 or more.'),
  ('adv.bulletin_invalid', 'tl', 'Ang numero ng bulletin ay dapat buong numero, 1 o higit.'),
  ('adv.bulletin_invalid', 'ceb', 'Ang numero sa bulletin kinahanglan tibuok nga numero, 1 o labaw.'),

  ('adv.wind', 'en', 'WIND (KPH)'),
  ('adv.wind', 'tl', 'HANGIN (KPH)'),
  ('adv.wind', 'ceb', 'HANGIN (KPH)'),

  ('adv.wind_invalid', 'en', 'Wind speed must be a whole number from 0 to 500.'),
  ('adv.wind_invalid', 'tl', 'Ang lakas ng hangin ay dapat buong numero mula 0 hanggang 500.'),
  ('adv.wind_invalid', 'ceb', 'Ang kusog sa hangin kinahanglan tibuok nga numero gikan 0 ngadto 500.'),

  ('adv.leave_by_required', 'en', 'A leave-before time is required at Signal 3 and above.'),
  ('adv.leave_by_required', 'tl', 'Kailangan ng oras ng pag-alis sa Signal 3 pataas.'),
  ('adv.leave_by_required', 'ceb', 'Kinahanglan ang oras sa pagbiya sa Signal 3 pataas.'),

  ('adv.deadline_passed', 'en', 'THIS DEADLINE HAS PASSED'),
  ('adv.deadline_passed', 'tl', 'LUMIPAS ANG ORAS NA ITO'),
  ('adv.deadline_passed', 'ceb', 'MILABAY NA KINI NGA ORAS'),

  ('adv.preview', 'en', 'WHAT RESIDENTS WILL SEE'),
  ('adv.preview', 'tl', 'ANG MAKIKITA NG MGA RESIDENTE'),
  ('adv.preview', 'ceb', 'ANG MAKITA SA MGA RESIDENTE'),

  ('adv.hold_issue', 'en', 'Press and hold to issue Signal No. {n}'),
  ('adv.hold_issue', 'tl', 'Pindutin nang matagal para itakda ang Signal No. {n}'),
  ('adv.hold_issue', 'ceb', 'Pislita og dugay aron itakda ang Signal No. {n}'),

  ('adv.hold_lift', 'en', 'Press and hold to lift the signal'),
  ('adv.hold_lift', 'tl', 'Pindutin nang matagal para alisin ang signal'),
  ('adv.hold_lift', 'ceb', 'Pislita og dugay aron kuhaon ang signal'),

  ('adv.save_details', 'en', 'Save details'),
  ('adv.save_details', 'tl', 'I-save ang detalye'),
  ('adv.save_details', 'ceb', 'I-save ang detalye'),

  ('adv.not_sent', 'en', 'NOT SENT YET — residents have not been told Signal {n}. Use the megaphone or radio until this clears.'),
  ('adv.not_sent', 'tl', 'HINDI PA NAIPAPADALA — hindi pa naabisuhan ang mga residente ng Signal {n}. Gumamit ng megaphone o radyo hanggang mawala ito.'),
  ('adv.not_sent', 'ceb', 'WALA PA MAIPADALA — wala pa nahibalo ang mga residente sa Signal {n}. Gamita ang megaphone o radyo hangtod kini mawala.'),

  ('adv.not_sent_lift', 'en', 'NOT SENT YET — residents have not been told the signal was lifted.'),
  ('adv.not_sent_lift', 'tl', 'HINDI PA NAIPAPADALA — hindi pa naabisuhan ang mga residente na inalis ang signal.'),
  ('adv.not_sent_lift', 'ceb', 'WALA PA MAIPADALA — wala pa nahibalo ang mga residente nga gikuha ang signal.'),

  ('adv.refused', 'en', 'REFUSED — Signal {n} was not issued.'),
  ('adv.refused', 'tl', 'TINANGGIHAN — hindi naitakda ang Signal {n}.'),
  ('adv.refused', 'ceb', 'GISALIKWAY — wala natakda ang Signal {n}.'),

  ('adv.refused_lift', 'en', 'REFUSED — the signal was not lifted.'),
  ('adv.refused_lift', 'tl', 'TINANGGIHAN — hindi inalis ang signal.'),
  ('adv.refused_lift', 'ceb', 'GISALIKWAY — wala gikuha ang signal.'),

  ('adv.retry', 'en', 'Retry'),
  ('adv.retry', 'tl', 'Subukang muli'),
  ('adv.retry', 'ceb', 'Sulayi pag-usab'),

  ('adv.history', 'en', 'RECENT CHANGES'),
  ('adv.history', 'tl', 'MGA HULING PAGBABAGO'),
  ('adv.history', 'ceb', 'MGA BAG-OHAY NGA KAUSABAN'),

  ('adv.sent', 'en', 'SENT'),
  ('adv.sent', 'tl', 'NAIPADALA'),
  ('adv.sent', 'ceb', 'NAIPADALA'),

  ('adv.history_offline', 'en', 'Not available offline'),
  ('adv.history_offline', 'tl', 'Hindi available kung offline'),
  ('adv.history_offline', 'ceb', 'Dili available kung offline'),

  ('adv.before_history', 'en', 'set before history was recorded'),
  ('adv.before_history', 'tl', 'itinakda bago itinala ang kasaysayan'),
  ('adv.before_history', 'ceb', 'gitakda sa wala pa girekord ang kasaysayan'),

  ('adv.officials_only', 'en', 'Only an official can change the advisory.'),
  ('adv.officials_only', 'tl', 'Tanging opisyal ang maaaring baguhin ang abiso.'),
  ('adv.officials_only', 'ceb', 'Opisyal ra ang makausab sa pahibalo.')
on conflict (message_key, language) do update set text = excluded.text;
