-- Strings for resident names (0038). Reviewed languages, Filipino (= Tagalog)
-- and Ilocano; the other machine-translated languages fall back to Tagalog
-- for these (profile.* is optional in scripts/generate-translations.mjs).

insert into public.translations (message_key, language, text) values
  ('profile.title', 'en', 'WHO ARE YOU?'),
  ('profile.title', 'tl', 'SINO KA?'),
  ('profile.title', 'ceb', 'KINSA KA?'),
  ('profile.title', 'fil', 'SINO KA?'),
  ('profile.title', 'ilo', 'SINNO KA?'),

  ('profile.me', 'en', 'YOUR NAME'),
  ('profile.me', 'tl', 'IYONG PANGALAN'),
  ('profile.me', 'ceb', 'IMONG NGALAN'),
  ('profile.me', 'fil', 'IYONG PANGALAN'),
  ('profile.me', 'ilo', 'NAGANMO'),

  ('profile.intro', 'en', 'Your name lets the barangay trust your reports and find you in a rescue.'),
  ('profile.intro', 'tl', 'Sa iyong pangalan, mapagkakatiwalaan ng barangay ang iyong ulat at mahahanap ka sa pagsagip.'),
  ('profile.intro', 'ceb', 'Pinaagi sa imong ngalan, masaligan sa barangay ang imong report ug makit-an ka sa pagluwas.'),
  ('profile.intro', 'fil', 'Sa iyong pangalan, mapagkakatiwalaan ng barangay ang iyong ulat at mahahanap ka sa pagsagip.'),
  ('profile.intro', 'ilo', 'Babaen ti naganmo, mapagtalkan ti barangay dagiti report-mo ken masarakannaka iti panangisalakan.'),

  ('profile.first', 'en', 'FIRST NAME'),
  ('profile.first', 'tl', 'PANGALAN'),
  ('profile.first', 'ceb', 'NGALAN'),
  ('profile.first', 'fil', 'PANGALAN'),
  ('profile.first', 'ilo', 'NAGAN'),

  ('profile.last', 'en', 'LAST NAME'),
  ('profile.last', 'tl', 'APELYIDO'),
  ('profile.last', 'ceb', 'APELYIDO'),
  ('profile.last', 'fil', 'APELYIDO'),
  ('profile.last', 'ilo', 'APELYIDO'),

  ('profile.address', 'en', 'ADDRESS (OPTIONAL)'),
  ('profile.address', 'tl', 'TIRAHAN (OPSYONAL)'),
  ('profile.address', 'ceb', 'PUY-ANAN (OPSYONAL)'),
  ('profile.address', 'fil', 'TIRAHAN (OPSYONAL)'),
  ('profile.address', 'ilo', 'PAGTAENGAN (OPSIONAL)'),

  ('profile.address_hint', 'en', 'e.g. House 12, near the chapel'),
  ('profile.address_hint', 'tl', 'hal. Bahay 12, malapit sa kapilya'),
  ('profile.address_hint', 'ceb', 'pananglitan: Balay 12, duol sa kapilya'),
  ('profile.address_hint', 'fil', 'hal. Bahay 12, malapit sa kapilya'),
  ('profile.address_hint', 'ilo', 'kas pagarigan: Balay 12, asideg ti kapilya'),

  ('profile.privacy', 'en', 'Only barangay volunteers and officials can see your name and address — other residents cannot. They are used only for reports, SOS and evacuation.'),
  ('profile.privacy', 'tl', 'Ang mga boluntaryo at opisyal lang ng barangay ang makakakita ng iyong pangalan at tirahan — hindi ang ibang residente. Gagamitin lang ito sa mga ulat, SOS at paglikas.'),
  ('profile.privacy', 'ceb', 'Ang mga boluntaryo ug opisyal lang sa barangay ang makakita sa imong ngalan ug puy-anan — dili ang ubang residente. Gamiton lang kini sa mga report, SOS ug pagbakwit.'),
  ('profile.privacy', 'fil', 'Ang mga boluntaryo at opisyal lang ng barangay ang makakakita ng iyong pangalan at tirahan — hindi ang ibang residente. Gagamitin lang ito sa mga ulat, SOS at paglikas.'),
  ('profile.privacy', 'ilo', 'Dagiti laeng boluntario ken opisyal ti barangay ti makakita iti nagan ken pagtaenganmo — saan a dagiti sabali nga agnanaed. Maus-usar laeng dagitoy kadagiti report, SOS ken panagbakwit.'),

  ('profile.save', 'en', 'SAVE'),
  ('profile.save', 'tl', 'I-SAVE'),
  ('profile.save', 'ceb', 'I-SAVE'),
  ('profile.save', 'fil', 'I-SAVE'),
  ('profile.save', 'ilo', 'I-SAVE'),

  ('profile.later', 'en', 'LATER'),
  ('profile.later', 'tl', 'MAMAYA NA'),
  ('profile.later', 'ceb', 'UNYA NA'),
  ('profile.later', 'fil', 'MAMAYA NA'),
  ('profile.later', 'ilo', 'INTON KAMAUDIANAN'),

  ('profile.required_for_reports', 'en', 'Give your name to send a report'),
  ('profile.required_for_reports', 'tl', 'Ilagay ang iyong pangalan para makapagpadala ng ulat'),
  ('profile.required_for_reports', 'ceb', 'Isulod ang imong ngalan aron makapadala og report'),
  ('profile.required_for_reports', 'fil', 'Ilagay ang iyong pangalan para makapagpadala ng ulat'),
  ('profile.required_for_reports', 'ilo', 'Ikabilmo ti naganmo tapno makaipatulodka iti report'),

  ('profile.confirmed', 'en', 'CONFIRMED'),
  ('profile.confirmed', 'tl', 'KUMPIRMADO'),
  ('profile.confirmed', 'ceb', 'KUMPIRMADO'),
  ('profile.confirmed', 'fil', 'KUMPIRMADO'),
  ('profile.confirmed', 'ilo', 'NAKUMPIRMA'),

  ('profile.unconfirmed', 'en', 'NOT YET CONFIRMED'),
  ('profile.unconfirmed', 'tl', 'HINDI PA KUMPIRMADO'),
  ('profile.unconfirmed', 'ceb', 'WALA PA MAKUMPIRMA'),
  ('profile.unconfirmed', 'fil', 'HINDI PA KUMPIRMADO'),
  ('profile.unconfirmed', 'ilo', 'SAAN PAY A NAKUMPIRMA'),

  ('profile.confirm_hint', 'en', 'A volunteer confirms your name when they scan the QR on this tab at the evacuation center.'),
  ('profile.confirm_hint', 'tl', 'Kukumpirmahin ng boluntaryo ang iyong pangalan kapag na-scan nila ang QR sa tab na ito sa evacuation center.'),
  ('profile.confirm_hint', 'ceb', 'Kumpirmahon sa boluntaryo ang imong ngalan inig scan nila sa QR niining tab sa evacuation center.'),
  ('profile.confirm_hint', 'fil', 'Kukumpirmahin ng boluntaryo ang iyong pangalan kapag na-scan nila ang QR sa tab na ito sa evacuation center.'),
  ('profile.confirm_hint', 'ilo', 'Kumpirmaen ti boluntario ti naganmo no i-scan-da ti QR iti daytoy a tab iti evacuation center.'),

  ('profile.edit', 'en', 'EDIT'),
  ('profile.edit', 'tl', 'BAGUHIN'),
  ('profile.edit', 'ceb', 'USBA'),
  ('profile.edit', 'fil', 'BAGUHIN'),
  ('profile.edit', 'ilo', 'BALIWAN'),

  ('profile.edit_warning', 'en', 'Changing your name removes the confirmation. A volunteer will need to confirm it again.'),
  ('profile.edit_warning', 'tl', 'Kapag binago ang pangalan, mawawala ang kumpirmasyon. Kailangan itong kumpirmahin muli ng boluntaryo.'),
  ('profile.edit_warning', 'ceb', 'Kon usbon ang ngalan, mawala ang kumpirmasyon. Kinahanglan kini kumpirmahon pag-usab sa boluntaryo.'),
  ('profile.edit_warning', 'fil', 'Kapag binago ang pangalan, mawawala ang kumpirmasyon. Kailangan itong kumpirmahin muli ng boluntaryo.'),
  ('profile.edit_warning', 'ilo', 'No baliwam ti naganmo, maikkat ti kumpirmasion. Masapul a kumpirmaen manen ti boluntario.'),

  ('profile.no_name', 'en', 'NAME NOT GIVEN'),
  ('profile.no_name', 'tl', 'WALANG PANGALAN'),
  ('profile.no_name', 'ceb', 'WALAY NGALAN'),
  ('profile.no_name', 'fil', 'WALANG PANGALAN'),
  ('profile.no_name', 'ilo', 'AWAN TI NAGAN'),

  ('profile.none_on_device', 'en', 'This phone has not given a name.'),
  ('profile.none_on_device', 'tl', 'Walang ibinigay na pangalan ang teleponong ito.'),
  ('profile.none_on_device', 'ceb', 'Walay ngalan nga gihatag kining telepono.'),
  ('profile.none_on_device', 'fil', 'Walang ibinigay na pangalan ang teleponong ito.'),
  ('profile.none_on_device', 'ilo', 'Awan ti nagan nga inted daytoy a telepono.'),

  ('profile.confirm', 'en', 'Press and hold to confirm this person'),
  ('profile.confirm', 'tl', 'Pindutin nang matagal para kumpirmahin ang taong ito'),
  ('profile.confirm', 'ceb', 'Pindota ug dugay aron kumpirmahon kining tawhana'),
  ('profile.confirm', 'fil', 'Pindutin nang matagal para kumpirmahin ang taong ito'),
  ('profile.confirm', 'ilo', 'Ipindot a nabayag tapno kumpirmaen daytoy a tao'),

  ('profile.self', 'en', 'You cannot confirm yourself.'),
  ('profile.self', 'tl', 'Hindi mo makukumpirma ang iyong sarili.'),
  ('profile.self', 'ceb', 'Dili nimo makumpirma ang imong kaugalingon.'),
  ('profile.self', 'fil', 'Hindi mo makukumpirma ang iyong sarili.'),
  ('profile.self', 'ilo', 'Saanmo a makumpirma ti bagim.')
on conflict (message_key, language) do update set text = excluded.text;
