import { Fragment, useState } from 'react';
import { version } from '../../package.json';
import { renamePattern, useApp } from '../state/store';
import { Button, Dialog, DialogButtons, Emblem, MessageBox, TextField } from '../ui/kit';
import { closeDialog, useDialogs } from './dialogStore';
import { ExportDialog } from './ExportDialog';
import { BlockLibraryDialog, SoundLibraryDialog } from './LibraryDialog';
import { SHORTCUT_GROUPS } from './shortcuts';
import { UpdateDialog } from './UpdateDialog';

function AboutDialog() {
  return (
    <Dialog title="About Hadjitron 3000" onClose={closeDialog} width={360}>
      <div className="h-app-about">
        <Emblem />
        <div className="h-app-about-text">
          <p className="h-app-about-name">Hadjitron 3000</p>
          <p>Version {version}</p>
          <p>
            A small music machine for building sounds in the Factory, putting them into blocks on the Track and
            arranging the blocks in the Song. Make yourself a cup of tea and play something.
          </p>
          <p className="h-app-about-credits">
            Fusion Pixel by TakWolf and Departure Mono by Helena Zhang, both under the SIL Open Font License.
          </p>
        </div>
      </div>
      <DialogButtons>
        <Button primary onClick={closeDialog}>
          OK
        </Button>
      </DialogButtons>
    </Dialog>
  );
}

function ShortcutsDialog() {
  return (
    <Dialog title="Keyboard Shortcuts" onClose={closeDialog}>
      <div className="h-app-shortcuts">
        {SHORTCUT_GROUPS.map((group) => (
          <Fragment key={group.label}>
            <div className="h-app-shortcuts-head">{group.label}</div>
            {group.keys.map(([key, action]) => (
              <Fragment key={key}>
                <span className="h-app-shortcuts-key">{key}</span>
                <span>{action}</span>
              </Fragment>
            ))}
          </Fragment>
        ))}
      </div>
      <DialogButtons>
        <Button primary onClick={closeDialog}>
          OK
        </Button>
      </DialogButtons>
    </Dialog>
  );
}

const BLOCK_NAME_LENGTH = 24;

function RenameBlockDialog({ patternId }: { patternId: string }) {
  const [name, setName] = useState(() => useApp.getState().project.patterns.find((p) => p.id === patternId)!.name);
  const rename = () => {
    if (!name.trim()) return;
    renamePattern(patternId, name);
    closeDialog();
  };
  return (
    <Dialog title="Rename Block" onClose={closeDialog}>
      <form
        className="h-app-form"
        onSubmit={(e) => {
          e.preventDefault();
          rename();
        }}
      >
        <span>Name:</span>
        <TextField value={name} onChange={setName} maxLength={BLOCK_NAME_LENGTH} width={180} autoFocus />
      </form>
      <DialogButtons>
        <Button primary disabled={!name.trim()} onClick={rename}>
          OK
        </Button>
        <Button onClick={closeDialog}>Cancel</Button>
      </DialogButtons>
    </Dialog>
  );
}

/** The open dialog, with the first waiting message box on top of it. */
export function Dialogs() {
  const dialog = useDialogs((s) => s.dialog);
  const message = useDialogs((s) => s.messages[0]);
  return (
    <>
      {dialog?.kind === 'library' && <SoundLibraryDialog replace={dialog.replace} />}
      {dialog?.kind === 'blocks' && <BlockLibraryDialog />}
      {dialog?.kind === 'rename' && <RenameBlockDialog patternId={dialog.patternId} />}
      {dialog?.kind === 'export' && <ExportDialog />}
      {dialog?.kind === 'about' && <AboutDialog />}
      {dialog?.kind === 'shortcuts' && <ShortcutsDialog />}
      {dialog?.kind === 'update' && <UpdateDialog />}
      {message && (
        <MessageBox
          key={message.id}
          title={message.title}
          icon={message.icon}
          text={message.text}
          buttons={message.buttons}
          onChoose={message.resolve}
        />
      )}
    </>
  );
}
