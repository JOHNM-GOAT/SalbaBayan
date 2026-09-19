# Machine translations

One file per language, one key per UI string. These are **machine translations
that no native speaker has checked yet**. The app says so: the language picker
lists them under "Machine-translated — not yet checked by a native speaker",
and every instruction card shows a note telling the resident to follow the
barangay's own announcement if anything is unclear.

How confident to be, roughly:

- **Fair:** Ilocano, Hiligaynon, Waray, Bikol, Kapampangan, Pangasinan,
  Chavacano, Kinaray-a, Aklanon, Surigaonon, Butuanon, Masbatenyo, Romblomanon.
  These have written sources; key disaster terms were checked online (for
  example Ilocano *agbakwit* and Kapampangan *albug* and *bagyu*).
- **Low:** Maranao, Maguindanao, Tausug, Asi, Cuyonon, Ibanag, Itawis, Ivatan,
  Kankanaey, Ibaloi, Tuwali, Isnag, Gaddang, Sambal, Yakan, Sinama.
- **Lowest:** Bolinao (derived from the Sambal file), T'boli, Tiruray and
  Hanunó'o. Some of this wording is closer to the regional lingua franca
  (Ilocano, Cebuano, Tagalog) than to the language itself.

## When a speaker corrects a language

1. Edit `translations/machine/<code>.json`.
2. Run `node scripts/generate-translations.mjs supabase/migrations/<next>_translations.sql`.
   It refuses to write if a key is missing or a `{n}` was dropped.
3. Apply that migration.
4. Once the whole language has been checked, remove its code from
   `MACHINE_TRANSLATED` in `src/lib/i18n.ts`, and it moves to "Translated".

Check the evacuation instructions first: the `action.*` and `headline.*` keys.
