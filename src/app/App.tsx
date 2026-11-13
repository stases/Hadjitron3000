import { useEffect, useState } from 'react';
import { TICKS_PER_STEP } from '../core/defaults';
import { barOf, beatOf } from '../core/meter';
import { heardAt, songBars } from '../core/sequencer';
import { platform } from '../platform';
import { playScope, setView, useApp } from '../state/store';
import type { AppState, View } from '../state/store';
import { FactoryView } from '../ui/factory';
import { Icon, MenuBar, Separator, StatusBar, StatusField, TabPage, Tabs, Window, useHintText } from '../ui/kit';
import { SongView } from '../ui/song';
import { TrackView } from '../ui/track';
import { position, sampleRate } from './audio';
import { documentName, dropFiles } from './commands';
import { Dialogs } from './Dialogs';
import { buildMenus } from './menus';
import { usePrefs } from './prefs';
import { Tour } from './tour/Tour';
import { Transport } from './Transport';
import './app.css';

const TABS = [
  { id: 'factory', label: 'Factory' },
  { id: 'track', label: 'Track' },
  { id: 'song', label: 'Song', tour: 'tab-song' },
];

function Menus() {
  const state = useApp();
  const prefs = usePrefs();
  return <MenuBar menus={buildMenus(state, prefs)} />;
}

/** Re-renders on every animation frame while `on`. */
function useFrames(on: boolean): void {
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!on) return;
    let frame = requestAnimationFrame(function loop(time) {
      setFrame(time);
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [on]);
}

/** The sample rate of the audio context, once there is one. */
function useSampleRate(): number {
  const [rate, setRate] = useState(sampleRate);
  useEffect(() => {
    if (rate) return;
    const timer = setInterval(() => setRate(sampleRate()), 250);
    return () => clearInterval(timer);
  }, [rate]);
  return rate;
}

/**
 * What Play plays, the block or the song, and then where the transport is (bar.beat) while playing or how long
 * it is while stopped.
 */
function playText(state: AppState): [string, string] {
  const { project, scope } = state;
  const bars = (n: number) => `${n} ${n === 1 ? 'bar' : 'bars'}`;
  const pattern = project.patterns.find((p) => p.id === state.patternId)!;
  if (scope === 'song' && project.song.length === 0) return ['The song is empty', ''];
  const what = scope === 'song' ? 'Song' : `Block ${pattern.name}`;
  if (!state.playing) return [what, scope === 'song' ? bars(songBars(project)) : bars(pattern.bars)];
  const step = Math.max(0, Math.floor(position()));
  const bar = barOf(project.meter);
  const at = scope === 'song' ? step % (songBars(project) * bar.steps)
    : heardAt(project, playScope(state), step * TICKS_PER_STEP)[0].tick / TICKS_PER_STEP;
  return [what, `${Math.floor(at / bar.steps) + 1}.${beatOf(at % bar.steps, bar) + 1}`];
}

function Status() {
  const hint = useHintText();
  const state = useApp();
  const rate = useSampleRate();
  useFrames(state.playing);
  const [what, detail] = playText(state);
  return (
    <StatusBar>
      <StatusField>{hint || 'Ready.'}</StatusField>
      <StatusField width={190}>
        <span className="h-app-where">
          <span className="h-app-where-what">{what}</span>
          {detail && <span>{` · ${detail}`}</span>}
        </span>
      </StatusField>
      <StatusField width={70}>{rate ? `${(rate / 1000).toFixed(1)} kHz` : ''}</StatusField>
    </StatusBar>
  );
}

/** True while files are dragged over the window; dropping them hands them to `dropFiles`. */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(true);
    };
    const onLeave = (e: DragEvent) => !e.relatedTarget && setOver(false);
    const onDrop = (e: DragEvent) => {
      setOver(false);
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      void dropFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return over;
}

function useWindowActive(): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const on = () => setActive(true);
    const off = () => setActive(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return active;
}

export function App() {
  const name = useApp((s) => documentName(s));
  const dirty = useApp((s) => s.dirty);
  const view = useApp((s) => s.view);
  const active = useWindowActive();
  const dropping = useFileDrop();
  const win = platform.window;

  useEffect(() => platform.setDocument(name, dirty), [name, dirty]);

  return (
    <Window
      className="h-app"
      title={`${name}${dirty ? '*' : ''} - Hadjitron 3000`}
      icon={<Icon name="app" />}
      active={active}
      controls={
        win
          ? { onMinimize: () => win.minimize(), onMaximize: () => win.toggleMaximize(), onClose: () => win.close() }
          : undefined
      }
    >
      <Menus />
      <Separator />
      <Transport />
      <div className="h-app-views">
        <Tabs tabs={TABS} value={view} onChange={(id) => setView(id as View)} />
        <TabPage>
          <div className="h-app-view">{view === 'factory' ? <FactoryView /> : view === 'track' ? <TrackView /> : <SongView />}</div>
        </TabPage>
        {dropping && (
          <div className="h-app-drop">
            <div className="h-app-drop-card">Drop audio files, sounds, blocks or a project to add or open them.</div>
          </div>
        )}
      </div>
      <Status />
      <Tour />
      <Dialogs />
    </Window>
  );
}
