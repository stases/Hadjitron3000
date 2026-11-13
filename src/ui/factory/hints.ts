// What each parameter does, in the words the status bar uses: module type -> parameter id -> one sentence.

const adsr = (what: string) => ({
  attack: `How long ${what} takes to rise when a note starts: short for a snap, long for a swell.`,
  decay: `How long ${what} takes to fall from the peak to the sustain level.`,
  sustain: `Where ${what} settles while the key is held, as a share of the peak.`,
  release: `How long ${what} takes to fade out after the key is let go.`,
});

const pitch = 'Tunes the sound up or down in semitones; twelve make an octave.';
const modVel = 'How much harder notes get more of this modulator and softer ones less; it works on each note only.';
const fine = 'Nudges the tuning by hundredths of a semitone, for gentle detuning.';
const draw = 'Draw one cycle of the wave with the mouse; hold Shift for a straight line. Notes you hold follow along.';

export const PARAM_HINTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  osc: {
    wave: 'The basic shape of the tone: sine is pure, saw is bright and buzzy, square is hollow; Draw is your own.',
    shape: draw,
    pitch,
    fine,
    voices: 'How many copies of the oscillator play at once; more voices sound fatter.',
    spread: 'How far the extra voices drift apart in tuning; more spread sounds wider and wobblier.',
    width: 'How the voices are spread between left and right.',
    noise: 'How much hiss is mixed in with the tone.',
    pw: 'How wide the square wave is: 50 % is the plain square, narrower sounds thin and nasal; an LFO here shimmers.',
    wave2: 'The shape of the second oscillator, which plays along with the first.',
    shape2: draw,
    pitch2: 'Tunes the second oscillator against the first: seven semitones is a fifth, twelve an octave.',
    fine2: 'Detunes the second oscillator a little against the first, for a slow, fat beating.',
    mix2: 'How much of the second oscillator you hear: none at the left, half of each in the middle, all at the right.',
    sub: 'Adds a pure sine an octave or two below the note, for weight underneath.',
    subOct: 'Whether the sub sits one octave or two below the note.',
  },
  play: {
    mode: 'Poly plays chords; Mono plays one note at a time; Legato glides into a note while the last is still held.',
    glide: 'How long each new note takes to slide up or down from the note before it.',
  },
  voicefilter: {
    on: 'Switches the filter on or off.',
    mode: 'Which part of each note gets through: low pass keeps the bottom, high pass the top, band pass the middle.',
    cutoff: 'How bright each note is: lower values cut more of the top, and an envelope pointed here opens each note.',
    reso: 'How much the filter rings around its cutoff; high values whistle.',
    slope: '12 dB cuts gently; 24 dB cuts twice as steeply, for a rounder, more squelchy bass.',
    drive: 'Pushes each note into the filter harder, so it growls and the ringing gets thick.',
    key: 'How far the cutoff follows the note: at 100 % high notes are as bright as low ones.',
    vel: 'How much softer notes close the filter; below zero they open it instead.',
  },
  fm: {
    pitch,
    fine,
    ratio: 'How fast the hidden modulator runs against the note: whole numbers ring, odd values clang.',
    amount: 'How hard the modulator pushes the tone: low is soft, high is bright and metallic.',
  },
  noise: {
    color: 'The kind of hiss: white is bright, pink is softer, brown is a deep rumble.',
  },
  sample: {
    sample: 'Opens an audio file for the sampler to play.',
    pitch,
    fine,
    start: 'Where in the file playback begins; drag the left marker on the display to set it.',
    end: 'Where in the file playback stops; drag the right marker on the display to set it.',
    loop: 'Plays the part between the markers over and over while the key is held.',
    xfade: 'Blends the end of the loop into its start, so rain or room tone goes round without a click at the seam.',
    reverse: 'Plays the sample backwards.',
    mode: 'One shot plays the whole sample on every hit; Gate stops it when the key is let go.',
  },
  amp: adsr('the volume'),
  filter: {
    mode: 'Which part of the notes together gets through: low pass the bottom, high pass the top, band pass the middle.',
    cutoff: 'How bright the sound is: lower values cut more of the top.',
    reso: 'How much the filter rings around its cutoff; high values whistle.',
  },
  eq: {
    low: 'Turns the bass up or down: the body and the boom below about 200 Hz.',
    mid: 'Turns the middle up or down around Mid Freq: boxy or hollow when cut, nasal or forward when raised.',
    freq: 'Where the Mid knob works, from the low mids up to the presence around 4 kHz.',
    high: 'Turns the treble up or down: the air and the sizzle above about 4 kHz.',
    lowcut: 'Takes away everything below this frequency, rumble first; at the bottom it is off.',
  },
  compressor: {
    threshold: 'How loud the sound must get before it is turned down; lower means more of it is squeezed.',
    ratio: 'How hard the sound is turned down above the threshold: 2:1 is gentle, 20:1 is a wall.',
    attack: 'How fast it grabs a loud note: slow lets the snap of a kick through, fast flattens it.',
    release: 'How fast it lets go after a loud note: short pumps along with the beat, long holds the sound steady.',
    makeup: 'Turns the squeezed sound back up, so it is as loud as before but denser.',
    mix: 'How much of the squeezed sound is blended with the untouched one; halfway keeps the punch and adds weight.',
  },
  drive: {
    shape: 'How the sound is squashed: soft warms it up, hard crunches, fold turns it inside out.',
    amount: 'How hard the sound is driven into distortion.',
    tone: 'How much of the fizzy top end the distortion keeps.',
    mix: 'How much of the distorted sound is blended with the clean one.',
  },
  crusher: {
    bits: 'How finely each sample is measured: 16 bits is clean, 8 is gritty, below 4 it falls apart into fizz.',
    rate: 'How often the sound is sampled: lower rates add the metallic ring of an old sampler, high notes fold down.',
    mix: 'How much of the crushed sound is blended with the clean one.',
  },
  tape: {
    wow: 'How much the pitch drifts slowly up and down, like a warped cassette.',
    flutter: 'How much the pitch trembles quickly, like a worn tape transport; a little gives a gentle shimmer.',
    hiss: 'How much tape hiss sits under the sound while it plays.',
    sat: 'How hard the sound is pushed into the tape: loud parts get rounder and warmer.',
    age: 'How dull the tape is: new tape keeps the highs, old tape rolls them off.',
  },
  ring: {
    freq: 'The pitch the sound is multiplied with: high values give metal and bells, a few hertz a throbbing pulse.',
    mix: 'How much of the ringing sound you hear; halfway at a low frequency is a plain tremolo.',
  },
  comb: {
    freq: 'The pitch the comb rings at; a short burst of noise through it sounds like a plucked string.',
    feedback: 'How long it rings: near the ends it rings on and on; below zero it rings an octave lower and hollow.',
    damp: 'How fast the bright part of the ringing dies away: more damping sounds like nylon, less like steel.',
    mix: 'How much of the ringing is blended with the dry sound.',
  },
  chorus: {
    rate: 'How fast the copies drift in and out of tune.',
    depth: 'How far the copies drift; a little thickens the sound, a lot makes it seasick.',
    spread: 'How far the copies sit apart between left and right.',
    mix: 'How much of the drifting copies is blended with the dry sound.',
  },
  phaser: {
    rate: 'How fast the sweep moves up and down; below 0.1 Hz it shows how many seconds one sweep takes.',
    sync: 'Locks the sweep to the tempo, one cycle per bar, beat or note; Free lets you set the rate yourself.',
    depth: 'How far the sweep travels, from a gentle shimmer to a deep whoosh.',
    feedback: 'Makes the sweep ring and whistle more.',
    stages: 'Four stages give the soft swirl of a classic phaser, eight a thicker, more liquid one.',
    mix: 'How much of the swept sound is blended with the dry one; halfway gives the deepest notches.',
  },
  width: {
    width: 'How wide the sound is: 0 % is mono, 100 % as it was, 200 % spreads it far apart.',
    bass: 'Keeps everything below this frequency in the middle, so the bass stays solid on any speaker.',
  },
  delay: {
    sync: 'The echo spacing in notes at the song tempo, or Free to set it in milliseconds.',
    time: 'The echo spacing in seconds; only used when Sync is set to Free.',
    feedback: 'How many times the echo repeats before it dies away.',
    tone: 'How dark the echoes get: lower values make each repeat duller.',
    lowcut: 'Takes the bass out of every repeat a little more, so the echoes thin out as they fade, as in dub.',
    pingpong: 'Bounces the echoes between left and right.',
    mix: 'How loud the echoes are against the dry sound.',
  },
  reverb: {
    size: 'How long the room rings after the sound stops.',
    tone: 'How bright the room sounds: lower values give a darker hall.',
    mix: 'How much room is blended in with the dry sound.',
  },
  space: {
    size: 'How long the space rings after the sound stops, from a small room to a minute-long cloud.',
    tone: 'How bright the space sounds: lower values let the high ringing die away sooner.',
    mix: 'How much of the space is blended in with the dry sound.',
    freeze: 'Holds the ringing as it is, for ever, while new notes play dry on top; an export ends a minute later.',
    shimmer: 'Feeds the ringing back in an octave higher, so the tail rises and glitters as it fades.',
  },
  env: { ...adsr('this envelope'), vel: modVel },
  lfo: {
    wave: 'The shape of the wobble: sine glides, square jumps between two values.',
    rate: 'How fast the wobble goes, in cycles per second; below 0.1 Hz it shows how many seconds one cycle takes.',
    sync: 'Locks the wobble to the tempo, one cycle per bar, beat or note; Free lets you set the rate yourself.',
    fade: 'How long the wobble takes to grow from nothing to its full amount after a note starts.',
    retrigger: 'Starts the wobble from the beginning with every note. An LFO in each note always does.',
    vel: modVel,
  },
  drift: {
    rate: 'How often the drift heads for a new random value: slow settings wander over minutes.',
    smooth: 'At 0 % the drift jumps from value to value; at 100 % it glides gently between them.',
    vel: modVel,
  },
  out: {
    level: 'How loud this sound plays in the mix.',
    pan: 'Where the sound sits between the left and the right speaker.',
  },
};

/** The status bar for the modulator's own controls. */
export const MOD_HINTS = {
  target: 'Which control this modulator moves.',
  amount: 'How far the modulator moves its target, up or down; in the middle it does nothing.',
  note: 'Every note gets its own copy of this modulator, which starts with the note.',
  sound: 'One modulator for the whole sound, shared by all its notes.',
  fixed: 'This target belongs to the whole sound, so the modulator works on the whole sound.',
};

/** The status bar for the mixer's controls, in the Mixer and for the sends in the Factory's Output unit. */
export const MIXER_HINTS = {
  send: (bus: string) => `How much of this sound goes to ${bus}, the shared effects that every sound can send to.`,
  level: (name: string) => `How loud ${name} plays in the mix. Drag up for louder, down for softer.`,
  mute: 'Mute: silence this sound, and what it sends to the buses.',
  solo: 'Solo: hear only this sound, and any others that are soloed too.',
  name: 'Click to pick this sound; double-click to open it in the Factory.',
  duck: 'Which sound pushes this one down: every note it plays makes this one dip, even while it is muted.',
  duckAmount: 'How far this sound dips when the other one plays: at 100 % it falls silent for a moment.',
  duckRelease: 'How long this sound takes to swell back after each dip: short pumps, long breathes.',
  busLevel: (bus: string) => `How loud ${bus} comes back into the mix. Drag up for louder, down for softer.`,
  busMute: (bus: string) => `Mute: silence ${bus}. The sounds sent to it still play dry.`,
  busRack: (bus: string) => `Shows the effects of ${bus} below, to change, add or take them away.`,
  busName: 'The name of this bus, as its strip and the send knobs show it.',
  bus: (letter: string, bus: string) => `Bus ${letter}, ${bus}: shared effects that every sound can send to.`,
  masterStrip: 'The master: everything you hear and export, after the buses.',
  master: 'Volume of everything you hear and export.',
  masterRack: 'Shows the effects on the master below. They work on everything you hear and export.',
  meter: 'How loud this is right now; the red lamps at the top mean it is too loud.',
};
