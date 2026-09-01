"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

// react-router's <NavLink> gave the sidebar active-state styling via an
// isActive render prop — next/link has no equivalent, so this derives the
// same thing from the current pathname.
export function NavLink({
  href,
  children,
  className,
  activeClassName,
  onNavigate,
}: {
  href: string
  children: ReactNode
  className: string
  activeClassName: string
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const isActive = pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Link href={href} onClick={onNavigate} className={`${className} ${isActive ? activeClassName : ''}`}>
      {children}
    </Link>
  )
}
