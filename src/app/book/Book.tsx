import { useEffect, useMemo, useRef } from 'react';
import { LEVEL_NAMES, levelOf } from '../../core/levels';
import { MODULES } from '../../core/modules';
import type { ParamSpec } from '../../core/modules';
import { formatValue } from '../../core/params';
import { DIVISIONS, fundamental, sweep, timebase } from '../../core/scope';
import { songBars } from '../../core/sequencer';
import { EnvelopeDisplay } from '../../ui/factory/EnvelopeDisplay';
import { PARAM_HINTS } from '../../ui/factory/hints';
import { Button, Icon, ListBox, Scope, TitleBar, Toolbar, useHint } from '../../ui/kit';
import type { ListItem } from '../../ui/kit';
import { cx } from '../../ui/kit/cx';
import { renderedScope, sampleRate } from '../audio';
import { setPrefs, usePrefs } from '../prefs';
import { nextStep, previousStep, useTour } from '../tour/tourStore';
import { CHAPTERS, PAGES, findPage, pageKey } from './pages';
import type {
  ComparePiece, Example, ExamplePiece, KnobsPiece, Page, Piece, TermsPiece, WorkedPiece,
} from './pages';
import {
  closeBook, finishWorked, hear, loadExample, startWorked, turnBy, turnTo, useBook,
} from './bookStore';
import './book.css';

const HINTS = {
  contents: 'Shows or hides the list of chapters beside the page.',
  previous: 'Turns back to the page before.',
  next: 'Turns to the next page.',
  list: 'The chapters of the book; pick one to read it, and a page under it to go there.',
  load: {
    sound: 'Adds this sound to your project and opens it in the Factory.',
    block: 'Adds this block, with the sounds it plays, to your project and opens it on the Track.',
    project: 'Opens this project in place of yours, after asking whether to save yours.',
  },
  hear: 'Plays this example without changing your project; press again to stop.',
  hearLong: 'Plays this whole song without changing your project, after a moment to get it ready; press again to stop.',
  start: 'Loads the starting point and points at the control of the first step.',
  finish: 'Loads the result of every step, so you can hear and see where the steps lead.',
  checkpoint: 'Loads the example with the steps up to here already done, and goes on from there.',
  back: 'Back to the step before.',
  step: 'On to the next step; it ticks itself off when you have done what it asks.',
};

/** The project an example makes, made once for the page. */
/** A song longer than this takes a moment to get ready, so its Hear button says so. */
const LONG_BARS = 16;

const useMade = (example: Example) => useMemo(() => example.make(), [example]);

function HearButton({ example }: { example: Example }) {
  const project = useMade(example);
  const hearing = useBook((s) => s.hearing === example);
  const rendering = useBook((s) => (s.hearing === example ? s.rendering : null));
  const long = project.song.length > 0 && songBars(project) > LONG_BARS;
  return (
    <>
      <Button pressed={hearing} onClick={() => void hear(example)} hint={long ? HINTS.hearLong : HINTS.hear}>
        {hearing ? 'Stop' : 'Hear it'}
      </Button>
      {rendering !== null && (
        <span className="h-book-rendering">{`Getting it ready... ${Math.round(rendering * 100)} %`}</span>
      )}
    </>
  );
}

function LoadButton({ example }: { example: Example }) {
  return (
    <Button onClick={() => void loadExample(example)} hint={HINTS.load[example.kind]}>
      Load this example
    </Button>
  );
}

/** The scope while an example plays, with a timebase that fits the first note it plays. */
function HearScope({ example }: { example: Example }) {
  const project = useMade(example);
  const hearing = useBook((s) => s.hearing === example);
  const sound = project.channels[0].sound;
  const note = Object.values(project.patterns[0].notes)[0]?.[0]?.note ?? 60;
  const hover = useHint('The wave of this example while it plays, like the scope in the Factory.');
  return (
    <div className="h-book-picture" {...hover.props}>
      <Scope
        read={(buf) => (hearing ? renderedScope(buf) : buf.fill(0))}
        width={10 * 24 + 1}
        height={8 * 10 + 1}
        samples={32768}
        sweep={(buf) => sweep(buf, sampleRate() * DIVISIONS * timebase(fundamental(sound, note)))}
      />
    </div>
  );
}

function ExampleBox({ piece }: { piece: ExamplePiece }) {
  const { example, picture } = piece;
  const project = useMade(example);
  return (
    <section className="h-book-box">
      <span className="h-book-box-label">Example</span>
      <p className="h-book-box-title">{example.title}</p>
      <div className="h-book-buttons">
        <LoadButton example={example} />
        <HearButton example={example} />
      </div>
      {picture === 'scope' && <HearScope example={example} />}
      {picture === 'envelope' && (
        <div className="h-book-picture">
          <EnvelopeDisplay params={project.channels[0].sound.amp} width={240} height={48} />
        </div>
      )}
    </section>
  );
}

function Steps({ piece }: { piece: WorkedPiece }) {
  const running = useTour((s) => s.steps === piece.steps);
  const index = useTour((s) => s.index);
  const done = useTour((s) => s.done);
  const ticked = useTour((s) => s.ticked);
  const current = useRef<HTMLLIElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest' });
  }, [running, index]);
  const { steps } = piece;
  return (
    <ol className="h-book-steps">
      {steps.map((step, i) => {
        const now = running && i === index;
        const tick = running && ticked.includes(i);
        return (
          <li key={i} ref={now ? current : undefined} className={cx('h-book-step', now && 'is-current')}>
            <span className="h-book-step-mark">{tick ? <Icon name="check" /> : `${i + 1}.`}</span>
            <div className="h-book-step-body">
              {step.title && <p className="h-book-step-title">{step.title}</p>}
              <p>{step.text}</p>
              {now && (
                <div className="h-book-step-foot">
                  <span className="h-book-count">
                    Step {i + 1} of {steps.length}
                  </span>
                  {step.done && done && (
                    <span className="h-book-done">
                      <Icon name="check" />
                      Done
                    </span>
                  )}
                  <span className="h-book-nav">
                    <Button onClick={previousStep} disabled={i === 0} hint={HINTS.back}>
                      Back
                    </Button>
                    <Button primary={done || !step.done} onClick={nextStep} hint={HINTS.step}>
                      {i === steps.length - 1 ? 'Finish' : 'Next'}
                    </Button>
                  </span>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function WorkedBox({ piece }: { piece: WorkedPiece }) {
  const { example, checkpoints } = piece;
  return (
    <section className="h-book-box">
      <span className="h-book-box-label">Worked example</span>
      <p className="h-book-box-title">{example.title}</p>
      <div className="h-book-buttons">
        <Button onClick={() => void startWorked(piece)} hint={HINTS.start}>
          Load this example
        </Button>
        <Button onClick={() => void finishWorked(piece)} hint={HINTS.finish}>
          Show me the finished one
        </Button>
        {example.kind !== 'project' && <HearButton example={example} />}
      </div>
      {checkpoints && (
        <div className="h-book-buttons">
          <span className="h-book-caption">Start after</span>
          {checkpoints.map((c) => (
            <Button key={c.label} small onClick={() => void startWorked(piece, c.after)} hint={HINTS.checkpoint}>
              {c.label}
            </Button>
          ))}
        </div>
      )}
      <Steps piece={piece} />
      <p className="h-book-result">{piece.result}</p>
    </section>
  );
}

function CompareBox({ piece }: { piece: ComparePiece }) {
  return (
    <section className="h-book-box">
      <span className="h-book-box-label">Before and after</span>
      <div className="h-book-pair">
        {[piece.before, piece.after].map((example) => (
          <div key={example.title} className="h-book-side">
            <p className="h-book-box-title">{example.title}</p>
            <div className="h-book-buttons">
              <HearButton example={example} />
              <Button small onClick={() => void loadExample(example)} hint={HINTS.load[example.kind]}>
                Load
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** What a parameter can be set to, in words. */
function range(spec: ParamSpec): string {
  if (spec.kind === 'float') return `${formatValue(spec, spec.min)} to ${formatValue(spec, spec.max)}`;
  if (spec.kind === 'choice') return spec.options.map(([, label]) => label).join(', ');
  if (spec.kind === 'bool') return 'On or off';
  return '';
}

function KnobsTable({ piece }: { piece: KnobsPiece }) {
  const def = MODULES[piece.unit];
  const hints = PARAM_HINTS[def.type];
  const params = def.params.filter((p) => hints[p.id] && !(def.type === 'voicefilter' && p.id === 'on'));
  return (
    <section className="h-book-knobs">
      <p className="h-book-caption">What the knobs of {def.label} mean</p>
      <p>{piece.when}</p>
      <table className="h-book-table">
        <tbody>
          {params.map((spec) => (
            <tr key={spec.id}>
              <th>
                <span className="h-book-knob">{spec.label}</span>
                {levelOf(spec) > 1 && <span className="h-book-level">{LEVEL_NAMES[levelOf(spec)]}</span>}
                <span className="h-book-range">{range(spec)}</span>
              </th>
              <td>{hints[spec.id]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Terms({ piece }: { piece: TermsPiece }) {
  return (
    <dl className="h-book-terms">
      {piece.terms.map(([term, meaning]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

function PieceView({ piece }: { piece: Piece }) {
  if (typeof piece === 'string') return <p>{piece}</p>;
  switch (piece.kind) {
    case 'example':
      return <ExampleBox piece={piece} />;
    case 'worked':
      return <WorkedBox piece={piece} />;
    case 'compare':
      return <CompareBox piece={piece} />;
    case 'knobs':
      return <KnobsTable piece={piece} />;
    case 'envelope':
      return (
        <figure className="h-book-figure">
          <EnvelopeDisplay params={piece.params} width={240} height={48} />
          <figcaption>{piece.caption}</figcaption>
        </figure>
      );
    case 'terms':
      return <Terms piece={piece} />;
  }
}

function PageView({ chapter, page }: { chapter: number; page: Page }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [page]);
  return (
    <div className="h-book-page" ref={scroller}>
      <p className="h-book-chapter">
        Chapter {chapter + 1} · {CHAPTERS[chapter].title}
      </p>
      <h2 className="h-book-title">{page.title}</h2>
      {page.pieces.map((piece, i) => (
        <PieceView key={i} piece={piece} />
      ))}
    </div>
  );
}

/** The chapters, with the pages of the open one under it. */
function Contents({ chapter, page }: { chapter: number; page: number }) {
  const items: ListItem[] = CHAPTERS.flatMap((c, i) => [
    { id: pageKey(c, 0), label: `${i + 1}. ${c.title}`, icon: i === chapter ? 'book-open' : 'book' } as const,
    ...(i === chapter
      ? c.pages.slice(1).map((p, j) => ({ id: pageKey(c, j + 1), label: p.title, icon: 'page', indent: true } as const))
      : []),
  ]);
  return (
    <div className="h-book-contents">
      <ListBox items={items} value={pageKey(CHAPTERS[chapter], page)} onChange={turnTo} hint={HINTS.list} />
    </div>
  );
}

/** The Guide Book: a window beside the views with the contents, the page, and Previous and Next. */
export function Book() {
  const open = useBook((s) => s.open);
  const key = usePrefs((p) => p.bookPage);
  const contents = usePrefs((p) => p.bookContents);
  if (!open) return null;
  const { chapter, page } = findPage(key);
  const at = PAGES.findIndex((p) => p.chapter === chapter && p.page === page);
  return (
    <div className="h-book" role="complementary" aria-label="Guide Book">
      <TitleBar title="Guide Book" icon={<Icon name="book-open" />} controls={{ onClose: closeBook }} />
      <Toolbar className="h-book-tools">
        <Button pressed={contents} onClick={() => setPrefs({ bookContents: !contents })} hint={HINTS.contents}>
          Contents
        </Button>
        <span className="h-book-spacer" />
        <Button onClick={() => turnBy(-1)} disabled={at === 0} hint={HINTS.previous}>
          Previous
        </Button>
        <Button onClick={() => turnBy(1)} disabled={at === PAGES.length - 1} hint={HINTS.next}>
          Next
        </Button>
      </Toolbar>
      <div className="h-book-body">
        {contents && <Contents chapter={chapter} page={page} />}
        <PageView chapter={chapter} page={CHAPTERS[chapter].pages[page]} />
      </div>
    </div>
  );
}
