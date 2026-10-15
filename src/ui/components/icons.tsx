import {
  Anvil,
  BookOpen,
  Cpu,
  Droplets,
  FlaskConical,
  Globe,
  GraduationCap,
  Hammer,
  Landmark,
  Languages,
  LifeBuoy,
  MessagesSquare,
  Soup,
  Sprout,
  SquareTerminal,
  Stethoscope,
  Zap,
} from 'lucide-react';
import type { SourceGroup } from '../../shared/api';

type Icon = typeof BookOpen;

const CATEGORY_ICONS: Array<[RegExp, Icon]> = [
  [/medic|health|first aid/i, Stethoscope],
  [/water|sanit/i, Droplets],
  [/agri|animal|farm|garden|seed/i, Sprout],
  [/food|preserv|cook|canning/i, Soup],
  [/surviv|emergenc/i, LifeBuoy],
  [/carpent|construct|building/i, Hammer],
  [/metal|forg|weld/i, Anvil],
  [/electr|energy|solar|power/i, Zap],
  [/math|science|physic|chemi/i, FlaskConical],
  [/linux|ubuntu/i, SquareTerminal],
  [/comput|software|tech/i, Cpu],
  [/language|educat|school|teach|read/i, Languages],
  [/communit|govern|law|organi/i, Landmark],
];

export function categoryIcon(label: string): Icon {
  for (const [re, icon] of CATEGORY_ICONS) if (re.test(label)) return icon;
  return BookOpen;
}

export const GROUP_ICONS: { [G in SourceGroup]: Icon } = {
  books: BookOpen,
  reference: Globe,
  khan: GraduationCap,
  qa: MessagesSquare,
};
