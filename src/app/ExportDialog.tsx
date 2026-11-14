import { useEffect, useRef, useState } from 'react';
import { encodeMp3, renderProject, renderStems } from '../audio';
import { TICKS_PER_STEP } from '../core/defaults';
import { LEVEL_NAMES } from '../core/levels';
import { eventsBetween, loopSteps } from '../core/sequencer';
import type { Pcm, PlayScope, Project } from '../core/types';
import { encodeWav } from '../core/wav';
import { platform } from '../platform';
import { useApp } from '../state/store';
import { toggleFold, useShown } from '../ui/factory/levels';
import {
  Button, Checkbox, Dialog, DialogButtons, FoldToggles, GroupBox, ProgressBar, Select, Stepper,
} from '../ui/kit';
import { documentName, writeFile } from './commands';
import { closeDialog, fail, reason } from './dialogStore';
import { usePrefs } from './prefs';

const FORMATS = [
  { value: 'wav', label: 'WAV, 16-bit' },
  ...[128, 192, 256, 320].map((kbps) => ({ value: String(kbps), label: `MP3, ${kbps} kbit/s` })),
];
const SELECT_WIDTH = 220; // "Block: " and a name of 24 characters
const STEMS_HINT = 'One file per sound, all one length; added up they can differ a little from the mix, as each meets '
  + 'the soft clipper alone.';

/** File names for the stems, "<name> - <sound>", safe for a file system and different from each other. */
export function stemNames(name: string, sounds: string[], ext: string): string[] {
  const used = new Set<string>();
  return sounds.map((sound) => {
    const plain = `${name} - ${sound}`.replace(/[/\\:*?"<>|\0-\x1f]/g, '-').replace(/^\.+/, '');
    let unique = plain;
    for (let i = 2; used.has(unique.toLowerCase()); i++) unique = `${plain} ${i}`;
    used.add(unique.toLowerCase());
    return `${unique}.${ext}`;
  });
}

/** Render the song or the current block and save it as WAV or MP3, as one file or one file for each sound. */
export function ExportDialog() {
  const patternId = useApp((s) => s.patternId);
  const block = useApp((s) => s.project.patterns.find((p) => p.id === s.patternId)!.name);
  const beginner = usePrefs((p) => p.beginner);
  const shaping = useShown()('export', 2);
  const [what, setWhat] = useState(() => useApp.getState().scope);
  const [repeats, setRepeats] = useState(1);
  const [format, setFormat] = useState('wav');
  const [ringOut, setRingOut] = useState(true);
  const [stems, setStems] = useState(false);
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const mp3 = format !== 'wav';
  const ext = mp3 ? 'mp3' : 'wav';
  const opts = { loops: what === 'pattern' ? repeats : 1, tail: ringOut ? undefined : 0 };

  /** Encode one render; `from` and `to` are the share of the progress bar it covers. */
  const encode = (pcm: Pcm, label: string, from: number, to: number): Promise<Uint8Array> | Uint8Array => (
    mp3
      ? encodeMp3(pcm, Number(format), (value) => {
        if (cancelled.current) throw new Error('cancelled');
        setProgress({ label, value: from + value * (to - from) });
      })
      : encodeWav(pcm)
  );

  const exportMix = async (project: Project, scope: PlayScope, name: string) => {
    let bytes: Uint8Array;
    try {
      setProgress({ label: 'Rendering…', value: 0 });
      const pcm = await renderProject(project, scope, {
        ...opts,
        onProgress: (value) => {
          if (!cancelled.current) setProgress({ label: 'Rendering…', value: mp3 ? value / 2 : value });
        },
      });
      if (cancelled.current) return;
      bytes = await encode(pcm, 'Encoding MP3…', 0.5, 1);
    } catch (error) {
      if (cancelled.current) return;
      setProgress(null);
      await fail(`The audio could not be exported${reason(error)}.`);
      return;
    }
    if (cancelled.current) return;
    closeDialog();
    await writeFile({
      title: 'Export Audio',
      defaultName: `${name}.${ext}`,
      filters: [{ name: mp3 ? 'MP3 audio' : 'WAV audio', extensions: [ext] }],
      bytes,
    });
  };

  const exportStems = async (project: Project, scope: PlayScope, name: string) => {
    try {
      const folder = await platform.chooseFolder({ title: 'Export a File for Each Sound' });
      if (!folder || cancelled.current) return;
      const share = mp3 ? 0.5 : 0.9;
      const rendered = await renderStems(project, scope, {
        ...opts,
        onProgress: (value, channel) => {
          if (!cancelled.current) setProgress({ label: `Rendering ${channel.sound.name}…`, value: value * share });
        },
      });
      const names = stemNames(name, rendered.map((s) => s.channel.sound.name), ext);
      for (const [i, { channel, pcm }] of rendered.entries()) {
        if (cancelled.current) return;
        const from = share + (i / rendered.length) * (1 - share);
        const label = `${mp3 ? 'Encoding' : 'Writing'} ${channel.sound.name}…`;
        setProgress({ label, value: from });
        const bytes = await encode(pcm, label, from, share + ((i + 1) / rendered.length) * (1 - share));
        await folder.write(names[i], bytes);
      }
    } catch (error) {
      if (cancelled.current) return;
      setProgress(null);
      await fail(`The files could not be exported${reason(error)}. Check that you may write to the folder.`);
      return;
    }
    if (!cancelled.current) closeDialog();
  };

  const run = async () => {
    const { project } = useApp.getState();
    const scope: PlayScope = what === 'song' ? { kind: 'song' } : { kind: 'pattern', patternId };
    if (eventsBetween(project, scope, 0, loopSteps(project, scope) * TICKS_PER_STEP).length === 0) {
      await fail(what === 'song'
        ? 'The song has no notes to export. Place blocks with notes in the Song view first.'
        : `The block ${block} has no notes to export. Add some notes first.`);
      return;
    }
    const name = what === 'song' ? documentName() : `${documentName()} - ${block}`;
    await (stems ? exportStems(project, scope, name) : exportMix(project, scope, name));
  };

  const busy = progress !== null;
  return (
    <Dialog title="Export Audio" onClose={closeDialog} width={380}>
      <GroupBox label="Export">
        <div className="h-app-form">
          <span>What:</span>
          <Select
            value={what}
            options={[
              { value: 'song', label: 'The song' },
              { value: 'pattern', label: `Block: ${block}` },
            ]}
            onChange={(v) => setWhat(v as 'song' | 'pattern')}
            width={SELECT_WIDTH}
            disabled={busy}
          />
          <span>Repeats:</span>
          <Stepper value={repeats} min={1} max={16} onChange={setRepeats} width={52} disabled={busy || what === 'song'} />
          <span>Format:</span>
          <Select value={format} options={FORMATS} onChange={setFormat} width={SELECT_WIDTH} disabled={busy} />
          <span />
          <Checkbox
            checked={ringOut}
            onChange={setRingOut}
            label="Let the end ring out"
            hint="Echoes and long notes fade out after the end; when off, the file stops exactly at the loop end."
            disabled={busy}
          />
          {beginner && (
            <>
              <span />
              <FoldToggles
                row
                folds={[{
                  label: LEVEL_NAMES[2],
                  open: shaping,
                  lit: stems,
                  hint: 'Shows more ways to export; the lamp lights when one is chosen.',
                  onToggle: () => toggleFold('export', 2),
                }]}
              />
            </>
          )}
          {shaping && (
            <>
              <span />
              <Checkbox
                checked={stems}
                onChange={setStems}
                label="Separate file for each sound"
                hint={STEMS_HINT}
                disabled={busy}
              />
            </>
          )}
        </div>
      </GroupBox>
      <div className="h-app-export-progress">
        <span>{progress?.label ?? 'Ready to export.'}</span>
        <ProgressBar value={progress?.value ?? 0} />
      </div>
      <DialogButtons>
        <Button primary disabled={busy} onClick={() => void run()}>
          Export
        </Button>
        <Button onClick={closeDialog}>Cancel</Button>
      </DialogButtons>
    </Dialog>
  );
}
