// The example songs of File > Open Example, one for each kind of music the app is made for. Each is short, built
// from four to six blocks that the Block Library also offers.

import type { Project } from '../../core/types';
import { acidProject } from './acid';
import { ambientProject } from './ambient';
import { experimentalProject } from './experimental';
import { organicProject } from './organic';
import { technoProject } from './techno';
import { tranceProject } from './trance';

export const EXAMPLES: readonly { name: string; project: () => Project }[] = [
  { name: 'Techno', project: technoProject },
  { name: 'Trance', project: tranceProject },
  { name: 'Acid', project: acidProject },
  { name: 'Experimental', project: experimentalProject },
  { name: 'Organic', project: organicProject },
  { name: 'Ambient', project: ambientProject },
];
