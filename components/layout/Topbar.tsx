'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Sidebar } from './Sidebar';

export function Topbar({ email }: { email: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 lg:px-6">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="Open navigation"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M3 5h14v2H3V5zm0 4h14v2H3V9zm0 4h14v2H3v-2z" />
          </svg>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                {email.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-[180px] truncate sm:inline">{email}</span>
            </button>

            {menuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                />
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <p className="truncate border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                    {email}
                  </p>
                  <Link
                    href="/settings"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Settings
                  </Link>
                  <form action="/auth/signout" method="post">
                    <button
                      type="submit"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Log out
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
          />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-slate-200 bg-white">
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
