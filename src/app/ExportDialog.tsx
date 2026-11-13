import { useEffect, useRef, useState } from 'react';
import { encodeMp3, renderProject } from '../audio';
import { eventsBetween, loopSteps } from '../core/sequencer';
import type { PlayScope } from '../core/types';
import { encodeWav } from '../core/wav';
import { useApp } from '../state/store';
import { Button, Checkbox, Dialog, DialogButtons, GroupBox, ProgressBar, Select, Stepper } from '../ui/kit';
import { documentName, writeFile } from './commands';
import { closeDialog, fail, reason } from './dialogStore';

const FORMATS = [
  { value: 'wav', label: 'WAV, 16-bit' },
  ...[128, 192, 256, 320].map((kbps) => ({ value: String(kbps), label: `MP3, ${kbps} kbit/s` })),
];
const RING_OUT_SECONDS = 6;

/** Render the song or the current pattern and save it as WAV or MP3. */
export function ExportDialog() {
  const patternId = useApp((s) => s.patternId);
  const pattern = `Pattern ${useApp((s) => s.project.patterns.find((p) => p.id === s.patternId)!.name)}`;
  const [what, setWhat] = useState(() => useApp.getState().scope);
  const [repeats, setRepeats] = useState(1);
  const [format, setFormat] = useState('wav');
  const [ringOut, setRingOut] = useState(true);
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = async () => {
    const { project } = useApp.getState();
    const scope: PlayScope = what === 'song' ? { kind: 'song' } : { kind: 'pattern', patternId };
    const steps = loopSteps(project, scope);
    if (eventsBetween(project, scope, 0, steps).length === 0) {
      await fail(what === 'song'
        ? 'The song has no notes to export. Add patterns with notes to the song first.'
        : `${pattern} has no notes to export. Add some steps first.`);
      return;
    }
    const mp3 = format !== 'wav';
    const ext = mp3 ? 'mp3' : 'wav';
    const name = what === 'song' ? documentName() : `${documentName()} - ${pattern}`;
    let bytes: Uint8Array;
    try {
      setProgress({ label: 'Rendering…', value: 0 });
      const pcm = await renderProject(project, scope, {
        loops: what === 'pattern' ? repeats : 1,
        tail: ringOut ? RING_OUT_SECONDS : 0,
        onProgress: (value) => {
          if (!cancelled.current) setProgress({ label: 'Rendering…', value: mp3 ? value / 2 : value });
        },
      });
      if (cancelled.current) return;
      bytes = mp3
        ? await encodeMp3(pcm, Number(format), (value) => {
          if (cancelled.current) throw new Error('cancelled');
          setProgress({ label: 'Encoding MP3…', value: 0.5 + value / 2 });
        })
        : encodeWav(pcm);
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

  const busy = progress !== null;
  return (
    <Dialog title="Export Audio" onClose={closeDialog} width={340}>
      <GroupBox label="Export">
        <div className="h-app-form">
          <span>What:</span>
          <Select
            value={what}
            options={[
              { value: 'song', label: 'The song' },
              { value: 'pattern', label: pattern },
            ]}
            onChange={(v) => setWhat(v as 'song' | 'pattern')}
            width={150}
            disabled={busy}
          />
          <span>Repeats:</span>
          <Stepper value={repeats} min={1} max={16} onChange={setRepeats} width={52} disabled={busy || what === 'song'} />
          <span>Format:</span>
          <Select value={format} options={FORMATS} onChange={setFormat} width={150} disabled={busy} />
          <span />
          <Checkbox
            checked={ringOut}
            onChange={setRingOut}
            label="Let the end ring out"
            hint="Echoes and long notes fade out after the end; when off, the file stops exactly at the loop end."
            disabled={busy}
          />
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
