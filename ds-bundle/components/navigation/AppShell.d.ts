import * as React from 'react';
import { IconName } from '../forms/Icon';

export interface NavItem { id: string; label: React.ReactNode; icon?: IconName; }
export interface NavGroup { group?: string; items: NavItem[]; }

/**
 * Kerangka admin: sidebar berkelompok + topbar breadcrumb + konten.
 * Nav diturunkan dari alur kerja, bukan satu-menu-per-tabel.
 * @startingPoint section="Navigation" subtitle="Kerangka admin: sidebar + topbar" viewport="1280x800"
 */
export interface AppShellProps {
  brand?: { name?: string; logo?: React.ReactNode };
  nav?: NavGroup[];
  active?: string;
  onNavigate?: (id: string) => void;
  user?: { name?: string; role?: string };
  breadcrumb?: React.ReactNode | React.ReactNode[];
  children?: React.ReactNode;
}

export declare function AppShell(props: AppShellProps): React.JSX.Element;
