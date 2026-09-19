-- Strings for the Callaguip relocation: the language picker, the official's
-- population figure, the household count, and the evacuation-centre editor.
--
-- English, Tagalog and Cebuano — the three languages the app is translated
-- into. The picker now offers many more, and those fall back to the barangay's
-- default language per string (FR-3.5), which the picker says out loud.
-- Ilocano, the language of Batac, has no strings yet; translating the app into
-- it is the first follow-up in docs/HANDOFF-callaguip.md, and should be done or
-- checked by a native speaker.

insert into public.translations (message_key, language, text) values
  ('ui.lang_translated', 'en', 'Translated'),
  ('ui.lang_translated', 'tl', 'May salin'),
  ('ui.lang_translated', 'ceb', 'Adunay hubad'),

  ('ui.lang_other', 'en', 'Not translated yet — shown in {n}'),
  ('ui.lang_other', 'tl', 'Wala pang salin — ipapakita sa {n}'),
  ('ui.lang_other', 'ceb', 'Wala pay hubad — ipakita sa {n}'),

  ('off.population', 'en', 'POPULATION'),
  ('off.population', 'tl', 'POPULASYON'),
  ('off.population', 'ceb', 'POPULASYON'),

  ('off.source', 'en', 'Source:'),
  ('off.source', 'tl', 'Pinagmulan:'),
  ('off.source', 'ceb', 'Gikan sa:'),

  ('hh.title', 'en', 'HOUSEHOLDS'),
  ('hh.title', 'tl', 'MGA SAMBAHAYAN'),
  ('hh.title', 'ceb', 'MGA PANIMALAY'),

  ('hh.hint', 'en', 'How many households are in the barangay. Readiness counts registrations against this.'),
  ('hh.hint', 'tl', 'Ilang sambahayan ang nasa barangay. Dito ibinabatay ang bilang ng nakarehistro.'),
  ('hh.hint', 'ceb', 'Pila ka panimalay ang naa sa barangay. Diri gibase ang ihap sa nakarehistro.'),

  ('hh.unset', 'en', 'Not set yet'),
  ('hh.unset', 'tl', 'Hindi pa naitakda'),
  ('hh.unset', 'ceb', 'Wala pa natakda'),

  ('hh.save', 'en', 'Save'),
  ('hh.save', 'tl', 'I-save'),
  ('hh.save', 'ceb', 'I-save'),

  ('hh.invalid', 'en', 'Enter a whole number, 1 or more.'),
  ('hh.invalid', 'tl', 'Maglagay ng buong numero, 1 o higit.'),
  ('hh.invalid', 'ceb', 'Pagbutang og tibuok nga numero, 1 o labaw.'),

  ('hh.saved', 'en', 'Saved on this phone — sent when there is signal.'),
  ('hh.saved', 'tl', 'Na-save sa telepono — ipapadala kapag may signal.'),
  ('hh.saved', 'ceb', 'Na-save sa telepono — ipadala kung naay signal.'),

  ('vol.capacity_unset', 'en', 'Capacity not set yet'),
  ('vol.capacity_unset', 'tl', 'Hindi pa naitakda ang kapasidad'),
  ('vol.capacity_unset', 'ceb', 'Wala pa natakda ang kapasidad'),

  ('ce.set', 'en', 'SET EVACUATION CENTRE'),
  ('ce.set', 'tl', 'ITAKDA ANG EVACUATION CENTER'),
  ('ce.set', 'ceb', 'ITAKDA ANG EVACUATION CENTER'),

  ('ce.tap', 'en', 'Tap the map inside the barangay where the evacuation centre is.'),
  ('ce.tap', 'tl', 'Pindutin ang mapa sa loob ng barangay kung saan ang evacuation center.'),
  ('ce.tap', 'ceb', 'Pislita ang mapa sulod sa barangay kung asa ang evacuation center.'),

  ('ce.outside', 'en', 'That point is outside the barangay.'),
  ('ce.outside', 'tl', 'Nasa labas ng barangay ang puntong iyan.'),
  ('ce.outside', 'ceb', 'Gawas sa barangay kana nga punto.'),

  ('ce.name', 'en', 'CENTRE NAME'),
  ('ce.name', 'tl', 'PANGALAN NG CENTER'),
  ('ce.name', 'ceb', 'NGALAN SA CENTER'),

  ('ce.capacity', 'en', 'CAPACITY (PEOPLE)'),
  ('ce.capacity', 'tl', 'KAPASIDAD (TAO)'),
  ('ce.capacity', 'ceb', 'KAPASIDAD (TAWO)'),

  ('ce.capacity_unset', 'en', 'Leave blank if not known'),
  ('ce.capacity_unset', 'tl', 'Iwanang blangko kung hindi alam'),
  ('ce.capacity_unset', 'ceb', 'Biyai nga blangko kung wala mahibaloi'),

  ('ce.capacity_invalid', 'en', 'Capacity must be a whole number, 1 or more — or left blank.'),
  ('ce.capacity_invalid', 'tl', 'Ang kapasidad ay dapat buong numero, 1 o higit — o iwanang blangko.'),
  ('ce.capacity_invalid', 'ceb', 'Ang kapasidad kinahanglan tibuok nga numero, 1 o labaw — o biyai nga blangko.'),

  ('ce.hold_save', 'en', 'Press and hold to move the evacuation centre'),
  ('ce.hold_save', 'tl', 'Pindutin nang matagal para ilipat ang evacuation center'),
  ('ce.hold_save', 'ceb', 'Pislita og dugay aron ibalhin ang evacuation center'),

  ('ce.cancel', 'en', 'CANCEL'),
  ('ce.cancel', 'tl', 'KANSELAHIN'),
  ('ce.cancel', 'ceb', 'KANSELAHON'),

  ('ce.saved', 'en', 'Saved on this phone. Every street''s route now leads to the new location.'),
  ('ce.saved', 'tl', 'Na-save sa telepono. Patungo na sa bagong lokasyon ang ruta ng bawat kalye.'),
  ('ce.saved', 'ceb', 'Na-save sa telepono. Padulong na sa bag-ong lokasyon ang ruta sa matag kalye.')
on conflict (message_key, language) do update set text = excluded.text;
