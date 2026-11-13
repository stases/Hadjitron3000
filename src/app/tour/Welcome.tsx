import { Button, Dialog, DialogButtons, Emblem } from '../../ui/kit';
import { closeDialog } from '../dialogStore';
import type { LessonId } from './lessons';
import { startLesson } from './tourStore';

const begin = (lesson: LessonId) => {
  closeDialog();
  void startLesson(lesson);
};

/** Shown once, on the very first launch, over the demo song. */
export function WelcomeDialog() {
  return (
    <Dialog title="Welcome to Hadjitron 3000" onClose={closeDialog} width={420}>
      <div className="h-app-about">
        <Emblem />
        <div className="h-app-about-text">
          <p>
            Hadjitron 3000 is a small music machine. You build sounds in the Factory, write short blocks of notes
            with them on the Track, and arrange the blocks into a song in the Song.
          </p>
          <p>
            A demo song is loaded; press Space to hear it. If all of this is new to you, a tutorial walks you through
            making a sound or a song step by step. Both stay in the Help menu for later.
          </p>
        </div>
      </div>
      <DialogButtons>
        <Button primary onClick={closeDialog}>
          Listen to the Demo
        </Button>
        <Button onClick={() => begin('sound')}>Make a Sound</Button>
        <Button onClick={() => begin('song')}>Make a Song</Button>
      </DialogButtons>
    </Dialog>
  );
}
