import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initAudio } from './app/audio';
import { confirmDiscard, openFile } from './app/commands';
import { installKeys } from './app/keys';
import { restoreSession, watchSession } from './app/session';
import { platform } from './platform';
import './ui/theme/base.css';

initAudio();
await restoreSession();
watchSession();
installKeys();
platform.onCloseRequest(confirmDiscard);
platform.onOpenFile((file) => void openFile(file));
await document.fonts.ready;
createRoot(document.getElementById('root')!).render(<App />);
