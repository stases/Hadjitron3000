import { useRef, useState } from 'react';
import { closeDialog } from '../../app/dialogStore';
import { TICKS_PER_STEP } from '../../core/defaults';
import { barOf } from '../../core/meter';
import { MAX_NOTE, MIN_NOTE, noteName } from '../../core/notes';
import { RANDOM_GRIDS, randomNotes } from '../../core/randomise';
import type { RandomSettings } from '../../core/randomise';
import { scaleText } from '../../core/scale';
import { patternSteps } from '../../core/sequencer';
import type { Note, Project } from '../../core/types';
import { replaceNotes, useApp } from '../../state/store';
import { Button, Dialog, DialogButtons, GroupBox, Select, Slider, Stepper, TextField } from '../kit';
import { loopOf } from './Grid';
import { positionText } from './roll';
import { useRoll } from './rollState';

const MAX_SEED = 99999;
const newSeed = () => 1 + Math.floor(Math.random() * MAX_SEED);

/** The settings of the last Randomise, so that the dialog opens as it was left. */
let last: RandomSettings & { replace: boolean } = {
  density: 0.5, grid: 24, centre: 60, range: 7, length: 0, velocity: 0.3, ratchet: 0, chance: 0, seed: newSeed(),
  replace: true,
};

/** Where the dialog writes: the row, and the ticks it fills, from the roll's stretch or the whole loop of the row. */
function target(project: Project, patternId: string, channelId: string) {
  const pattern = project.patterns.find((p) => p.id === patternId)!;
  const bar = barOf(project.meter);
  const end = loopOf(pattern, channelId, patternSteps(pattern, bar)) * TICKS_PER_STEP;
  const { open, range } = useRoll.getState();
  const from = open && range ? Math.min(range.from, end) : 0;
  return { bar, from, to: open && range ? Math.min(range.to, end) : end };
}

function Percent({ value, onChange, off, hint }: {
  value: number;
  onChange: (value: number) => void;
  off?: string;
  hint: string;
}) {
  return (
    <span className="h-track-random-field">
      <Slider value={value} onChange={(v) => onChange(Math.round(v * 100) / 100)} length={120} hint={hint} />
      <span className="h-track-value">{off && value === 0 ? off : `${Math.round(value * 100)} %`}</span>
    </span>
  );
}

/**
 * Fills the selected sound's row of the current block, or the stretch chosen on the roll's ruler, with notes drawn
 * from a seed. Apply writes them as one undo step and the dialog stays open: Apply again, or New for another seed
 * once applied, puts a new result in place of the last one within the same step.
 */
export function RandomiseDialog() {
  const [opened] = useState(() => {
    const { project, patternId, channelId } = useApp.getState();
    return { patternId, channelId: channelId!, ...target(project, patternId, channelId!) };
  });
  const name = useApp((s) => s.project.channels.find((c) => c.id === opened.channelId)?.sound.name ?? '');
  const scale = useApp((s) => s.project.scale);
  const [settings, setSettings] = useState(last);
  // The row as it was before the first Apply, and the take that keeps every Apply in one undo step.
  const session = useRef<{ base: Note[]; take: object; written: Project } | null>(null);
  const set = (change: Partial<typeof settings>) => setSettings((s) => (last = { ...s, ...change }));

  const apply = (s: typeof settings) => {
    const { project } = useApp.getState();
    const { patternId, channelId, bar, from, to } = opened;
    if (!session.current || session.current.written !== project) {
      const row = project.patterns.find((p) => p.id === patternId)?.notes[channelId] ?? [];
      session.current = { base: row, take: {}, written: project };
    }
    const { base, take } = session.current;
    const kept = s.replace ? base.filter((n) => n.start < from || n.start >= to) : base;
    replaceNotes(patternId, channelId, [...kept, ...randomNotes(s, scale, bar, from, to)], take);
    session.current.written = useApp.getState().project;
  };

  const reroll = () => {
    const next = { ...settings, seed: newSeed() };
    set({ seed: next.seed });
    if (session.current) apply(next);
  };

  const where = `${positionText(opened.from, opened.bar)} to ${positionText(opened.to, opened.bar)}`;
  return (
    <Dialog title="Randomise" onClose={closeDialog} width={360}>
      <p className="h-track-random-text">
        Fills {name} from {where} {scale ? `in ${scaleText(scale)}` : 'with any note'}.
      </p>
      <GroupBox label="Notes">
        <div className="h-app-form">
          <span>Density:</span>
          <Percent
            value={settings.density}
            onChange={(density) => set({ density })}
            hint="How many of the grid positions get a note: at 100 % every one."
          />
          <span>Grid:</span>
          <Select
            value={String(settings.grid)}
            options={RANDOM_GRIDS.map((g) => ({ value: String(g.ticks), label: g.label }))}
            onChange={(v) => set({ grid: Number(v) })}
            width={120}
            hint="The note value the positions are spaced by; a triplet fits three in the time of two."
          />
          <span>Centre:</span>
          <Stepper
            value={settings.centre}
            min={MIN_NOTE}
            max={MAX_NOTE}
            format={noteName}
            onChange={(centre) => set({ centre })}
            width={56}
            hint="The note the pitches gather around."
          />
          <span>Range:</span>
          <Stepper
            value={settings.range}
            min={0}
            max={24}
            format={(v) => `±${v}`}
            parse={(text) => Math.abs(parseFloat(text.replace('±', '')))}
            onChange={(range) => set({ range })}
            width={56}
            hint="How far the pitches go above and below the centre, in semitones; 12 is an octave each way."
          />
          <span>Length:</span>
          <Percent
            value={settings.length}
            onChange={(length) => set({ length })}
            hint="How much the lengths vary: at 0 every note is one grid step, at 100 % up to four."
          />
          <span>Velocity:</span>
          <Percent
            value={settings.velocity}
            onChange={(velocity) => set({ velocity })}
            hint="How much the velocities vary around 80 %: more makes some notes softer and others harder."
          />
          <span>Ratchets:</span>
          <Percent
            value={settings.ratchet}
            off="Off"
            onChange={(ratchet) => set({ ratchet })}
            hint="How many notes get a ratchet, played two to four times quickly inside their length."
          />
          <span>Chances:</span>
          <Percent
            value={settings.chance}
            off="Off"
            onChange={(chance) => set({ chance })}
            hint="How many notes play only sometimes, on a quarter, half or three quarters of the passes."
          />
          <span>Seed:</span>
          <span className="h-track-random-field">
            <TextField
              value={String(settings.seed)}
              onChange={(text) => {
                const seed = Number(text);
                if (Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED) set({ seed });
              }}
              width={64}
              maxLength={5}
              hint="The number the notes are drawn from: the same seed and settings always give the same notes."
            />
            <Button onClick={reroll} hint="Draws a new seed; once applied, its notes take the place of the last ones.">
              New
            </Button>
          </span>
          <span>Existing:</span>
          <span className="h-app-joined">
            <Button
              pressed={settings.replace}
              onClick={() => set({ replace: true })}
              hint="The notes already there are taken out first."
            >
              Replace
            </Button>
            <Button
              pressed={!settings.replace}
              onClick={() => set({ replace: false })}
              hint="The new notes go in among the ones already there."
            >
              Add
            </Button>
          </span>
        </div>
      </GroupBox>
      <DialogButtons>
        <Button primary onClick={() => apply(settings)}>
          Apply
        </Button>
        <Button onClick={closeDialog}>Close</Button>
      </DialogButtons>
    </Dialog>
  );
}
