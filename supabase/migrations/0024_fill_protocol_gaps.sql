-- Fill the seven empty Purok x Signal cells (FR-2.6).
--
-- The coverage grid showed 33 of 40: Signal 4 had no instruction for Puroks 4
-- and 7, and Signal 5 none for Puroks 1, 3, 4, 5 and 7. A resident of one of
-- those Puroks opening the app at that signal would have found no instruction
-- at all.
--
-- These follow the pattern every configured cell already uses, verified
-- against the live data before writing this: each signal level has a single
-- instruction for every Purok (Signal 4 "evacuate immediately", Signal 5 "stay
-- inside"), and every existing Signal 4 and Signal 5 row reuses that Purok's
-- Signal 3 route, route map and evacuation centre — all 9 of them, without
-- exception. So nothing here is a new decision about where anyone should go.
--
-- `on conflict do nothing` fills only cells that are still empty, so it never
-- overwrites a configured protocol and can be run again safely.
--
-- Worth knowing: the Signal 5 message is still missing one of the three
-- languages, as it was before this migration.

insert into public.protocols
  (purok_id, signal_level, route, route_geojson, evac_center_id, action_key)
select
  s3.purok_id,
  gap.level,
  s3.route,
  s3.route_geojson,
  s3.evac_center_id,
  case gap.level
    when 4 then 'action.evacuate_immediately'
    else 'action.stay_inside'
  end
from public.protocols s3
cross join (values (4), (5)) as gap(level)
where s3.signal_level = 3
on conflict (purok_id, signal_level) do nothing;
