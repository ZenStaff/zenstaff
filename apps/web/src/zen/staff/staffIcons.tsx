// Zen Staff AI staff: the role icons the catalog names (lucide, 2 px lines). Unknown names show a
// briefcase; never sparkles, robots or brains (brand rule).
import {
  BriefcaseIcon,
  CalendarCheckIcon,
  ChartColumnIcon,
  ClapperboardIcon,
  ClipboardListIcon,
  HandshakeIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  NewspaperIcon,
  PackageIcon,
  ReceiptIcon,
  SearchIcon,
  StoreIcon,
  type LucideIcon,
} from "lucide-react";

const ROLE_ICONS: Readonly<Record<string, LucideIcon>> = {
  store: StoreIcon,
  search: SearchIcon,
  receipt: ReceiptIcon,
  newspaper: NewspaperIcon,
  "message-circle": MessageCircleIcon,
  megaphone: MegaphoneIcon,
  handshake: HandshakeIcon,
  "clipboard-list": ClipboardListIcon,
  clapperboard: ClapperboardIcon,
  "chart-column": ChartColumnIcon,
  "calendar-check": CalendarCheckIcon,
  package: PackageIcon,
};

export function StaffRoleIcon(props: { readonly name: string; readonly className?: string }) {
  const Icon = ROLE_ICONS[props.name] ?? BriefcaseIcon;
  return <Icon className={props.className} aria-hidden />;
}
