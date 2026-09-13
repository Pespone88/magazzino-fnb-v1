export type NavigationKey =
  | 'home'
  | 'articles'
  | 'orders'
  | 'movements'
  | 'inventories'
  | 'more'

export interface NavigationItem {
  key: NavigationKey
  label: string
  shortLabel: string
}

export const primaryNavigation: readonly NavigationItem[] = [
  { key: 'home', label: 'Home', shortLabel: 'Home' },
  { key: 'articles', label: 'Articoli', shortLabel: 'Articoli' },
  { key: 'orders', label: 'Ordini', shortLabel: 'Ordini' },
  { key: 'movements', label: 'Movimenti', shortLabel: 'Movimenti' },
  { key: 'inventories', label: 'Inventari', shortLabel: 'Inventari' },
  { key: 'more', label: 'Altro', shortLabel: 'Altro' },
] as const
