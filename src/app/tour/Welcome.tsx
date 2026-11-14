import { Button, Dialog, DialogButtons, Emblem } from '../../ui/kit';
import { MAKE_A_SONG, MAKE_A_SOUND } from '../book/chapters/01-first-steps';
import { openBook, startWorked } from '../book/bookStore';
import type { WorkedPiece } from '../book/pages';
import { closeDialog } from '../dialogStore';

/** Open the Guide Book at a lesson of its first chapter and start it. */
const begin = (page: number, lesson: WorkedPiece) => {
  closeDialog();
  openBook('first-steps', page);
  void startWorked(lesson);
};

/** Shown once, on the very first launch, over the demo song. */
export function WelcomeDialog() {
  return (
    <Dialog title="Welcome to Hadjitron 3000" onClose={closeDialog} width={440}>
      <div className="h-app-about">
        <Emblem />
        <div className="h-app-about-text">
          <p>
            Hadjitron 3000 is a small music machine. You build sounds in the Factory, write short blocks of notes
            with them on the Track, and arrange the blocks into a song in the Song.
          </p>
          <p>
            A demo song is loaded; press Space to hear it. If all of this is new to you, two short lessons walk you
            through making a sound or a song step by step, and the Guide Book goes on from there to finished tracks.
            All of it stays in the Help menu for later.
          </p>
        </div>
      </div>
      <DialogButtons>
        <Button primary onClick={closeDialog}>
          Listen to the Demo
        </Button>
        <Button onClick={() => begin(2, MAKE_A_SOUND)}>Make a Sound</Button>
        <Button onClick={() => begin(3, MAKE_A_SONG)}>Make a Song</Button>
        <Button
          onClick={() => {
            closeDialog();
            openBook();
          }}
        >
          Guide Book
        </Button>
      </DialogButtons>
    </Dialog>
  );
}
