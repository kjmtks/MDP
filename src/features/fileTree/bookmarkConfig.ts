import type { SvgIconComponent } from '@mui/icons-material';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import StarIcon from '@mui/icons-material/Star';
import FlagIcon from '@mui/icons-material/Flag';
import FavoriteIcon from '@mui/icons-material/Favorite';
import LabelIcon from '@mui/icons-material/Label';
import PushPinIcon from '@mui/icons-material/PushPin';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

export const BOOKMARK_ICONS: Record<string, SvgIconComponent> = {
  bookmark: BookmarkIcon,
  star: StarIcon,
  flag: FlagIcon,
  favorite: FavoriteIcon,
  label: LabelIcon,
  pushpin: PushPinIcon,
  lightbulb: LightbulbIcon,
  check: CheckCircleIcon,
};

export const BOOKMARK_ICON_KEYS = Object.keys(BOOKMARK_ICONS);

export const BOOKMARK_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#f59e0b', // amber
  '#10b981', // green
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#94a3b8', // slate
];

export function bookmarkIconFor(key: string): SvgIconComponent {
  return BOOKMARK_ICONS[key] || BOOKMARK_ICONS.bookmark;
}
