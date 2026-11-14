import { useEffect, useState } from 'react';
import { platform } from '../platform';
import type { UpdateCheck, UpdateProgress, Updates } from '../platform/api';
import { Button, Dialog, DialogButtons, ProgressBar } from '../ui/kit';
import { closeDialog } from './dialogStore';

type Stage =
  | { kind: 'checking' }
  | { kind: 'checked'; check: UpdateCheck }
  | { kind: 'building'; progress: UpdateProgress }
  | { kind: 'failed'; error: string };

/** The error's own words, without the wrapping Electron adds to an error from the main process. */
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');

/** Whether the check found something newer. A build from source counts commits; a release compares versions. */
const newer = (updates: Updates, check: UpdateCheck) =>
  updates.kind === 'release' ? check.latest !== check.current : check.changes.length > 0;

function Changes({ changes }: { changes: string[] }) {
  return (
    <ul className="h-app-update-changes">
      {changes.map((change, i) => (
        <li key={i}>{change}</li>
      ))}
    </ul>
  );
}

function News({ updates, check }: { updates: Updates; check: UpdateCheck }) {
  const { current, latest, changes, blocked } = check;
  if (updates.kind === 'release') {
    return (
      <>
        <p>
          Version {latest} is on GitHub; you have {current}.{changes.length > 0 && ' What is new:'}
        </p>
        {changes.length > 0 && <Changes changes={changes} />}
        <p>
          Updating downloads the new version, installs it and restarts. Your sounds, blocks and projects stay where
          they are.
        </p>
      </>
    );
  }
  return (
    <>
      <p>
        {changes.length === 1 ? 'One change is' : `${changes.length} changes are`} waiting on GitHub ({current} →{' '}
        {latest}):
      </p>
      <Changes changes={changes} />
      {blocked ? (
        <p className="h-app-update-error">{blocked} Sort that out in Terminal first.</p>
      ) : (
        <p>
          Updating builds the new version, which takes a minute or two, then restarts. Your sounds, blocks and projects
          stay where they are.
        </p>
      )}
    </>
  );
}

function UpdateBody({ updates }: { updates: Updates }) {
  const [stage, setStage] = useState<Stage>({ kind: 'checking' });

  useEffect(() => {
    let live = true;
    updates.check().then(
      (check) => live && setStage({ kind: 'checked', check }),
      (error) => live && setStage({
        kind: 'failed',
        error: updates.kind === 'release' ? message(error) : `Could not reach GitHub.\n${message(error)}`,
      }),
    );
    return () => {
      live = false;
    };
  }, [updates]);

  const update = async () => {
    setStage({ kind: 'building', progress: { step: 'Getting ready', value: 0 } });
    try {
      await updates.build((progress) => setStage({ kind: 'building', progress }));
    } catch (error) {
      setStage({ kind: 'failed', error: `The update did not finish. This version keeps working.\n${message(error)}` });
      return;
    }
    closeDialog();
    updates.restart();
  };

  const building = stage.kind === 'building';
  const check = stage.kind === 'checked' ? stage.check : null;
  const found = check !== null && newer(updates, check);
  const available = found && !check.blocked;
  return (
    <Dialog title="Check for Updates" onClose={building ? () => {} : closeDialog} width={420}>
      <div className="h-app-update">
        {stage.kind === 'checking' && <p>Asking GitHub for news…</p>}
        {stage.kind === 'failed' && <p className="h-app-update-error">{stage.error}</p>}
        {check && !found && <p>You have the latest version ({check.current}).</p>}
        {check && found && <News updates={updates} check={check} />}
        {building && (
          <div className="h-app-export-progress">
            <span>{stage.progress.step}…</span>
            <ProgressBar value={stage.progress.value} />
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
