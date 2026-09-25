/**
 * The two sounds this app makes.
 *
 * Both are synthesised with the Web Audio API rather than played from a file,
 * and that is a deliberate choice for this product rather than a clever one.
 * An alarm that has to be fetched is an alarm that does not sound on the night
 * the network is gone — precisely the night it is needed. Nothing here is
 * downloaded, nothing has to be precached, and nothing can be evicted.
 *
 * Two sounds, and no more. A confirmation the resident hears on their own tap,
 * and an alarm the barangay hears when somebody calls for help. Anything else
 * that beeps trains people to ignore beeping, which is how the one that
 * matters gets missed.
 */

type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;

/**
 * The shared context, created lazily.
 *
 * Browsers hand this out already suspended until the page has been touched, so
 * it is created on first use and resumed on a gesture — see `unlockAudio`.
 * Returning null (no Web Audio, or the constructor threw) is a supported
 * outcome everywhere in this file: the badge, the banner and the screens all
 * still say what they said. Sound is an addition to this product, never the
 * only place something is stated.
 */
function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor: Ctor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Let this device make sound, from inside a gesture.
 *
 * Autoplay rules mean a page that has never been touched cannot make a noise,
 * which is the right default for the web and a problem for exactly one case
 * here: the incoming-rescue alarm is triggered by somebody else's emergency,
 * not by the volunteer's thumb. So the first touch anywhere in the app wakes
 * the context, and it stays awake for the session.
 */
export function unlockAudio(): void {
  const audio = context();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume().catch(() => {});
}

/** One note. Ramped at both ends, because a square-edged gain change clicks. */
function tone(
  audio: AudioContext,
  { at, freq, seconds, peak }: { at: number; freq: number; seconds: number; peak: number },
): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  /* A triangle rather than a sine: it carries through rain and a pocket, and
     unlike a square it does not sound like a broken appliance. */
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, at);

  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.012);
  gain.gain.setValueAtTime(peak, at + seconds - 0.03);
  gain.gain.linearRampToValueAtTime(0, at + seconds);

  osc.connect(gain).connect(audio.destination);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

/** Play a sequence, resuming the context first if a gesture allows it. */
function play(notes: (now: number) => void): void {
  const audio = context();
  if (!audio) return;
  if (audio.state === "suspended") {
    /* Inside a gesture this resolves and the sound lands; outside one it is
       refused, and refused silently is the correct outcome. */
    void audio.resume().then(() => notes(audio.currentTime + 0.02)).catch(() => {});
    return;
  }
  try {
    notes(audio.currentTime + 0.02);
  } catch {
    /* A context the browser tore down (backgrounded tab, page hidden on iOS). */
  }
}

/**
 * "It went." The resident's own SOS, acknowledged by the phone in their hand.
 *
 * Two notes rising. Rising, because this is the one sound in the product that
 * is good news — the request is durable and the timer has started — and a
 * falling pair reads as a failure whatever the screen says. Short, and quiet
 * enough not to be mistaken for the alarm below.
 */
export function playSOSSent(): void {
  play((now) => {
    const audio = context();
    if (!audio) return;
    tone(audio, { at: now, freq: 784, seconds: 0.11, peak: 0.16 });
    tone(audio, { at: now + 0.12, freq: 1175, seconds: 0.17, peak: 0.16 });
  });
}

/**
 * "Somebody is calling." The rescue alarm, on a volunteer's or an official's
 * phone, for a request that has just arrived.
 *
 * A two-tone alternation three times over, which is the shape every emergency
 * service on earth uses, for the reason they use it: it is not a noise a phone
 * makes for any other reason. Louder than the confirmation and longer than any
 * notification, because it has to survive a pocket, a generator and a room of
 * people talking.
 */
/**
 * When the alarm currently scheduled finishes, on the context's own clock.
 *
 * Calls do not queue behind each other and they do not stack. Two residents
 * pressing SOS half a second apart arrive as two separate realtime events, so
 * `IncomingSOSAlert` asks twice — and two of these sequences started out of
 * phase are not twice the warning, they are a mush that sounds like neither.
 * The alarm already means "somebody is calling"; sounding it again on top of
 * itself adds nothing to that. The badge and the queue carry the count.
 */
let alarmUntil = 0;

export function playIncomingSOS(): void {
  play((now) => {
    const audio = context();
    if (!audio) return;
    if (now < alarmUntil) return;

    for (let i = 0; i < 3; i++) {
      const at = now + i * 0.52;
      tone(audio, { at, freq: 988, seconds: 0.22, peak: 0.3 });
      tone(audio, { at: at + 0.24, freq: 740, seconds: 0.22, peak: 0.3 });
    }
    /* The last note ends at `now + 2 * 0.52 + 0.24 + 0.22`. */
    alarmUntil = now + 1.5;
  });
}
