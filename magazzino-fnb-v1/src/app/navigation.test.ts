import { describe, expect, it } from 'vitest'
import { primaryNavigation } from './navigation'

describe('primaryNavigation', () => {
  it('exposes the six approved top-level areas in the approved order', () => {
    expect(primaryNavigation.map((item) => item.label)).toEqual([
      'Home',
      'Articoli',
      'Ordini',
      'Movimenti',
      'Inventari',
      'Altro',
    ])
  })
})
