// What each parameter does, in the words the status bar uses: module type -> parameter id -> one sentence.

const adsr = (what: string) => ({
  attack: `How long ${what} takes to rise when a note starts: short for a snap, long for a swell.`,
  decay: `How long ${what} takes to fall from the peak to the sustain level.`,
  sustain: `Where ${what} settles while the key is held, as a share of the peak.`,
  release: `How long ${what} takes to fade out after the key is let go.`,
});

const pitch = 'Tunes the sound up or down in semitones; twelve make an octave.';
const fine = 'Nudges the tuning by hundredths of a semitone, for gentle detuning.';

export const PARAM_HINTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  osc: {
    wave: 'The basic shape of the tone: sine is pure, saw is bright and buzzy, square is hollow.',
    pitch,
    fine,
    voices: 'How many copies of the oscillator play at once; more voices sound fatter.',
    spread: 'How far the extra voices drift apart in tuning; more spread sounds wider and wobblier.',
    width: 'How the voices are spread between left and right.',
    noise: 'How much hiss is mixed in with the tone.',
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
    reverse: 'Plays the sample backwards.',
    mode: 'One shot plays the whole sample on every hit; Gate stops it when the key is let go.',
  },
  amp: adsr('the volume'),
  filter: {
    mode: 'Which part of the sound gets through: low pass keeps the bottom, high pass the top, band pass the middle.',
    cutoff: 'How bright the sound is: lower values cut more of the top.',
    reso: 'How much the filter rings around its cutoff; high values whistle.',
  },
  drive: {
    shape: 'How the sound is squashed: soft warms it up, hard crunches, fold turns it inside out.',
    amount: 'How hard the sound is driven into distortion.',
    tone: 'How much of the fizzy top end the distortion keeps.',
    mix: 'How much of the distorted sound is blended with the clean one.',
  },
  delay: {
    sync: 'The echo spacing in notes at the song tempo, or Free to set it in milliseconds.',
    time: 'The echo spacing in seconds; only used when Sync is set to Free.',
    feedback: 'How many times the echo repeats before it dies away.',
    tone: 'How dark the echoes get: lower values make each repeat duller.',
    pingpong: 'Bounces the echoes between left and right.',
    mix: 'How loud the echoes are against the dry sound.',
  },
  reverb: {
    size: 'How long the room rings after the sound stops.',
    tone: 'How bright the room sounds: lower values give a darker hall.',
    mix: 'How much room is blended in with the dry sound.',
  },
  env: adsr('this envelope'),
  lfo: {
    wave: 'The shape of the wobble: sine glides, square jumps between two values.',
    rate: 'How fast the wobble goes, in cycles per second.',
  },
  out: {
    level: 'How loud this sound plays in the mix.',
    pan: 'Where the sound sits between the left and the right speaker.',
  },
};
