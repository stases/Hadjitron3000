import type { Chapter } from '../pages';
import acid from './recipes/acid';
import ambient from './recipes/ambient';
import experimental from './recipes/experimental';
import organic from './recipes/organic';
import techno from './recipes/techno';
import trance from './recipes/trance';

const chapter: Chapter = {
  id: 'recipes',
  title: 'Recipes',
  pages: [
    {
      title: 'How the recipes work',
      pieces: [
        'Each recipe makes a whole piece in one style, from an empty project to an arranged and mixed track, with '
          + 'sounds from the library shaped a little for the style. The steps go in the order most producers work: '
          + 'drums first, then the bass, then what goes on top, then the arrangement, then the mix.',
        'Every recipe can be loaded part way, after the drums, after the bass and after the arrangement, so you can '
          + 'start where you like, or Show me the finished one to hear where it is going. Each page ends with what to '
          + 'change: a recipe is a starting point, and the piece becomes yours when you change it.',
      ],
    },
    techno, trance, acid, experimental, organic, ambient,
  ],
};

export default chapter;
