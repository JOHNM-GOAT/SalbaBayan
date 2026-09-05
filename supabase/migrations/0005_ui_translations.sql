-- Phase 1 — UI chrome strings.
--
-- FR-3.1 says *every* displayed message resolves through `translations` by
-- key + language. That includes labels, not only the protocol instructions —
-- an advisory whose body is Cebuano but whose labels are stuck in Tagalog has
-- not actually been translated.
--
-- Keeping these in the table rather than in the bundle is what makes FR-3.2
-- true: adding Ilocano is an INSERT, not a deploy.
--
-- `{n}` is the only placeholder, substituted client-side, so languages that
-- order the number differently can place it where it belongs.

insert into public.translations (message_key, language, text) values
  -- Signal placard
  ('ui.bulletin','tl','PAGASA BULLETIN {n}'),
  ('ui.bulletin','ceb','PAGASA BULLETIN {n}'),
  ('ui.bulletin','en','PAGASA BULLETIN {n}'),
  ('ui.signal_no','tl','SIGNAL NO. {n}'),
  ('ui.signal_no','ceb','SIGNAL NO. {n}'),
  ('ui.signal_no','en','SIGNAL NO. {n}'),
  ('ui.no_signal','tl','WALANG AKTIBONG SIGNAL'),
  ('ui.no_signal','ceb','WALAY AKTIBONG SIGNAL'),
  ('ui.no_signal','en','NO ACTIVE SIGNAL'),
  ('ui.no_signal_body','tl','Walang itinakdang signal ang barangay ngayon. Manatiling nakikinig sa bagong bulletin.'),
  ('ui.no_signal_body','ceb','Walay gitakdang signal ang barangay karon. Padayon sa pagpaminaw sa bag-ong bulletin.'),
  ('ui.no_signal_body','en','The barangay has no active signal set. Keep listening for the next bulletin.'),

  -- Deadline strip
  ('ui.leave_by','tl','UMALIS BAGO'),
  ('ui.leave_by','ceb','BIYA SA DILI PA'),
  ('ui.leave_by','en','LEAVE BEFORE'),
  ('ui.remaining','tl','NATITIRA'),
  ('ui.remaining','ceb','NAHIBILIN'),
  ('ui.remaining','en','REMAINING'),
  ('ui.deadline_passed','tl','LUMIPAS NA'),
  ('ui.deadline_passed','ceb','MILABAY NA'),
  ('ui.deadline_passed','en','PASSED'),

  -- Action card
  ('ui.what_to_do','tl','ANO ANG DAPAT GAWIN'),
  ('ui.what_to_do','ceb','UNSA ANG BUHATON'),
  ('ui.what_to_do','en','WHAT TO DO'),
  ('ui.evac_center','tl','EVACUATION CENTER'),
  ('ui.evac_center','ceb','EVACUATION CENTER'),
  ('ui.evac_center','en','EVACUATION CENTER'),

  -- The coverage gap. This is shown to a resident when their Purok has no
  -- protocol configured for the current signal level. It must never read as
  -- reassurance: the honest message is "we do not have guidance for you",
  -- plus the one action that still works.
  ('ui.no_protocol','tl','WALANG NAKATAKDANG PROTOCOL'),
  ('ui.no_protocol','ceb','WALAY NAKATAKDANG PROTOCOL'),
  ('ui.no_protocol','en','NO PROTOCOL CONFIGURED'),
  ('ui.no_protocol_body','tl','Walang nakatakdang tagubilin ang barangay para sa Purok na ito sa Signal No. {n}. Makipag-ugnayan sa barangay hall at sundin ang huling bulletin.'),
  ('ui.no_protocol_body','ceb','Walay gitakdang instruksyon ang barangay para niini nga Purok sa Signal No. {n}. Kontaka ang barangay hall ug sunda ang kataposang bulletin.'),
  ('ui.no_protocol_body','en','The barangay has not configured guidance for this Purok at Signal No. {n}. Contact the barangay hall and follow the last bulletin.'),

  -- Chrome
  ('ui.purok','tl','PUROK'),
  ('ui.purok','ceb','PUROK'),
  ('ui.purok','en','PUROK'),
  ('ui.language','tl','WIKA'),
  ('ui.language','ceb','PINULONGAN'),
  ('ui.language','en','LANGUAGE'),
  ('ui.showing_fallback','tl','Wala pa sa wikang ito. Ipinapakita sa {n}.'),
  ('ui.showing_fallback','ceb','Wala pa niini nga pinulongan. Gipakita sa {n}.'),
  ('ui.showing_fallback','en','Not yet available in this language. Showing {n}.'),

  -- Sync strip
  ('ui.never_synced','tl','HINDI PA NAKA-SYNC'),
  ('ui.never_synced','ceb','WALA PA MA-SYNC'),
  ('ui.never_synced','en','NEVER SYNCED'),
  ('ui.cached_now','tl','NAKA-CACHE NGAYON'),
  ('ui.cached_now','ceb','NA-CACHE KARON'),
  ('ui.cached_now','en','CACHED JUST NOW'),
  ('ui.cached_min','tl','NAKA-CACHE {n} MIN'),
  ('ui.cached_min','ceb','NA-CACHE {n} MIN'),
  ('ui.cached_min','en','CACHED {n} MIN AGO'),
  ('ui.cached_hour','tl','NAKA-CACHE {n} ORAS'),
  ('ui.cached_hour','ceb','NA-CACHE {n} ORAS'),
  ('ui.cached_hour','en','CACHED {n} HR AGO'),
  ('ui.offline','tl','OFFLINE'),
  ('ui.offline','ceb','OFFLINE'),
  ('ui.offline','en','OFFLINE'),
  ('ui.queued','tl','{n} NAKA-QUEUE'),
  ('ui.queued','ceb','{n} NAKA-QUEUE'),
  ('ui.queued','en','{n} QUEUED'),

  -- Coverage matrix (official-facing, FR-2.6)
  ('ui.coverage','tl','SAKLAW NG PROTOCOL'),
  ('ui.coverage','ceb','SAKUP SA PROTOCOL'),
  ('ui.coverage','en','PROTOCOL COVERAGE'),
  ('ui.coverage_complete','tl','Kumpleto ang lahat ng cell.'),
  ('ui.coverage_complete','ceb','Kompleto ang tanang cell.'),
  ('ui.coverage_complete','en','Every cell is configured.'),
  ('ui.coverage_gaps','tl','{n} cell ang walang protocol.'),
  ('ui.coverage_gaps','ceb','{n} ka cell ang walay protocol.'),
  ('ui.coverage_gaps','en','{n} cells have no protocol.')
on conflict (message_key, language) do update set text = excluded.text;

-- A deliberate translation gap, in the same spirit as the 7 deliberate holes
-- in the protocol grid.
--
-- With every string present in every language, the FR-3.5 fallback path has no
-- data that exercises it, and a broken fallback would ship looking fine. This
-- leaves Signal 5 untranslated in Cebuano, which is also the realistic case:
-- the rarest signal level is the one a barangay is least likely to have
-- finished translating. A Cebuano resident at Signal 5 now sees the Tagalog
-- text with an explicit notice, rather than a blank card.
delete from public.translations
where language = 'ceb'
  and message_key in ('action.stay_inside', 'headline.stay_inside');

-- Phase 2: writes the device has given up on. Worded as a failure, never
-- folded into the queued count — "3 queued" and "3 failed to send" mean
-- opposite things to someone deciding whether to walk to the barangay hall.
insert into public.translations (message_key, language, text) values
  ('ui.blocked','tl','{n} HINDI NAIPADALA'),
  ('ui.blocked','ceb','{n} WALA MAPADALA'),
  ('ui.blocked','en','{n} FAILED TO SEND')
on conflict (message_key, language) do update set text = excluded.text;
