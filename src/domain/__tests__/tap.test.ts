import { isTap } from '../tap';

describe('isTap', () => {
  it('bez punktu początkowego albo końcowego — dotknięcie (np. dotknięcie z czytnika ekranu)', () => {
    expect(isTap(null, { x: 1, y: 1 }, 10)).toBe(true);
    expect(isTap({ x: 1, y: 1 }, null, 10)).toBe(true);
  });
  it('ruch do granicy włącznie to dotknięcie, dalej — przeciągnięcie, w każdą stronę', () => {
    const s = { x: 100, y: 100 };
    expect(isTap(s, { x: 100, y: 100 }, 10)).toBe(true);
    expect(isTap(s, { x: 106, y: 108 }, 10)).toBe(true); // dokładnie 10
    expect(isTap(s, { x: 106, y: 109 }, 10)).toBe(false);
    expect(isTap(s, { x: 100, y: 89 }, 10)).toBe(false);
    expect(isTap(s, { x: 111, y: 100 }, 10)).toBe(false);
    expect(isTap(s, { x: 89, y: 100 }, 10)).toBe(false);
  });
});
