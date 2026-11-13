import { Fragment } from 'react';
import { version } from '../../package.json';
import { Button, Dialog, DialogButtons, Emblem, MessageBox } from '../ui/kit';
import { closeDialog, useDialogs } from './dialogs';
import { ExportDialog } from './ExportDialog';
import { LibraryDialog } from './LibraryDialog';
import { SHORTCUT_GROUPS } from './shortcuts';

function AboutDialog() {
  return (
    <Dialog title="About Hadjitron 3000" onClose={closeDialog} width={360}>
      <div className="h-app-about">
        <Emblem />
        <div className="h-app-about-text">
          <p className="h-app-about-name">Hadjitron 3000</p>
          <p>Version {version}</p>
          <p>
            A small music machine for building sounds in the Factory and putting them on the Track. Make yourself a cup
            of tea and play something.
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

/** The open dialog, with the first waiting message box on top of it. */
export function Dialogs() {
  const dialog = useDialogs((s) => s.dialog);
  const message = useDialogs((s) => s.messages[0]);
  return (
    <>
      {dialog?.kind === 'library' && <LibraryDialog replace={dialog.replace} />}
      {dialog?.kind === 'export' && <ExportDialog />}
      {dialog?.kind === 'about' && <AboutDialog />}
      {dialog?.kind === 'shortcuts' && <ShortcutsDialog />}
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
