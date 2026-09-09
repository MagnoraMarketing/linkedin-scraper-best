'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui';

const NAV = [
  { href: '/search', label: 'Search', icon: SearchIcon },
  { href: '/dashboard', label: 'Dashboard', icon: GridIcon },
  { href: '/leads', label: 'Leads', icon: UsersIcon },
  { href: '/jobs', label: 'Jobs', icon: ListIcon },
  { href: '/settings', label: 'Settings', icon: CogIcon },
] as const;

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Main">
      <div className="mb-4 px-2 pt-1">
        <span className="text-sm font-semibold tracking-tight text-slate-900">Lead Finder</span>
        <p className="text-xs text-slate-500">LinkedIn B2B prospecting</p>
      </div>

      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l3.58 3.58a1 1 0 01-1.42 1.42l-3.58-3.58A7 7 0 012 9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M3 3h6v6H3V3zm8 0h6v6h-6V3zM3 11h6v6H3v-6zm8 0h6v6h-6v-6z" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 9a3 3 0 100-6 3 3 0 000 6zM3 17a7 7 0 0114 0H3z" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M3 5h14v2H3V5zm0 4h14v2H3V9zm0 4h14v2H3v-2z" />
    </svg>
  );
}

function CogIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.34 2.3a1 1 0 011.32 0l.9.8 1.19-.2a1 1 0 011.13.66l.4 1.14 1.14.4a1 1 0 01.66 1.13l-.2 1.19.8.9a1 1 0 010 1.32l-.8.9.2 1.19a1 1 0 01-.66 1.13l-1.14.4-.4 1.14a1 1 0 01-1.13.66l-1.19-.2-.9.8a1 1 0 01-1.32 0l-.9-.8-1.19.2a1 1 0 01-1.13-.66l-.4-1.14-1.14-.4a1 1 0 01-.66-1.13l.2-1.19-.8-.9a1 1 0 010-1.32l.8-.9-.2-1.19a1 1 0 01.66-1.13l1.14-.4.4-1.14A1 1 0 016.25 2.9l1.19.2.9-.8zM10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"
        clipRule="evenodd"
      />
    </svg>
  );
}
