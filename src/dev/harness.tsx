// Development harness: one view with the demo project, before or without the real shell.
// dev.html#factory, dev.html#track, dev.html#track,play

import { createRoot } from 'react-dom/client';
import { initAudio } from '../app/audio';
import { demoProject } from '../presets/projects';
import { openProject, setPlaying, setView } from '../state/store';
import { FactoryView } from '../ui/factory';
import { StatusBar, StatusField, Window, useHintText } from '../ui/kit';
import { TrackView } from '../ui/track';

const [view, ...flags] = location.hash.slice(1).split(',');

function Harness() {
  const hint = useHintText();
  return (
    <Window title="Hadjitron 3000 - harness" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 6 }}>
        {view === 'factory' ? <FactoryView /> : <TrackView />}
      </div>
      <StatusBar>
        <StatusField>{hint || 'Ready.'}</StatusField>
      </StatusBar>
    </Window>
  );
}

initAudio();
openProject(demoProject(), null);
setView(view === 'factory' ? 'factory' : 'track');
if (flags.includes('play')) setPlaying(true);
void document.fonts.ready.then(() => createRoot(document.getElementById('root')!).render(<Harness />));
