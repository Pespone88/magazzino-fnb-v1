import { describe, expect, it } from 'vitest'
import { primaryNavigation } from './navigation'

describe('primaryNavigation', () => {
  it('exposes the four real top-level areas in the approved order', () => {
    expect(primaryNavigation.map((item) => item.label)).toEqual([
      'Home',
      'Articoli',
      'Ordini',
      'Altro',
    ])
  })
})
