import { useEffect, useState } from 'react';
import { platform } from '../platform';
import type { UpdateCheck, Updates } from '../platform/api';
import { Button, Dialog, DialogButtons, ProgressBar } from '../ui/kit';
import { closeDialog } from './dialogStore';

const STEPS = ['Fetching the new version', 'Installing packages', 'Building the application'];

type Stage =
  | { kind: 'checking' }
  | { kind: 'checked'; check: UpdateCheck }
  | { kind: 'building'; step: string }
  | { kind: 'failed'; error: string };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function UpdateBody({ updates }: { updates: Updates }) {
  const [stage, setStage] = useState<Stage>({ kind: 'checking' });

  useEffect(() => {
    let live = true;
    updates.check().then(
      (check) => live && setStage({ kind: 'checked', check }),
      (error) => live && setStage({ kind: 'failed', error: `Could not reach GitHub.\n${message(error)}` }),
    );
    return () => {
      live = false;
    };
  }, [updates]);

  const update = async () => {
    setStage({ kind: 'building', step: STEPS[0] });
    try {
      await updates.build((step) => setStage({ kind: 'building', step }));
    } catch (error) {
      setStage({ kind: 'failed', error: `The update did not finish. This version keeps working.\n${message(error)}` });
      return;
    }
    closeDialog();
    updates.restart();
  };

  const building = stage.kind === 'building';
  const check = stage.kind === 'checked' ? stage.check : null;
  const available = check && check.changes.length > 0 && !check.blocked;
  return (
    <Dialog title="Check for Updates" onClose={building ? () => {} : closeDialog} width={420}>
      <div className="h-app-update">
        {stage.kind === 'checking' && <p>Asking GitHub for news…</p>}
        {stage.kind === 'failed' && <p className="h-app-update-error">{stage.error}</p>}
        {check && check.changes.length === 0 && <p>You have the latest version ({check.current}).</p>}
        {check && check.changes.length > 0 && (
          <>
            <p>
              {check.changes.length === 1 ? 'One change is' : `${check.changes.length} changes are`} waiting on GitHub
              ({check.current} → {check.latest}):
            </p>
            <ul className="h-app-update-changes">
              {check.changes.map((change, i) => (
                <li key={i}>{change}</li>
              ))}
            </ul>
            {check.blocked ? (
              <p className="h-app-update-error">{check.blocked} Sort that out in Terminal first.</p>
            ) : (
              <p>Updating builds the new version, which takes a minute or two, then restarts. Your sounds, blocks and projects stay where they are.</p>
            )}
          </>
        )}
        {building && (
          <div className="h-app-export-progress">
            <span>{stage.step}…</span>
            <ProgressBar value={(STEPS.indexOf(stage.step) + 0.5) / STEPS.length} />
          </div>
        )}
      </div>
      <DialogButtons>
        {available && (
          <Button primary onClick={() => void update()}>
            Update and Restart
          </Button>
        )}
        {!building && (
          <Button primary={!available} onClick={closeDialog}>
            {available ? 'Later' : 'OK'}
          </Button>
        )}
      </DialogButtons>
    </Dialog>
  );
}

export function UpdateDialog() {
  return platform.updates ? <UpdateBody updates={platform.updates} /> : null;
}
