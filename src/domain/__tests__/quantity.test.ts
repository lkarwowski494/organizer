import { parseQuantity } from '../quantity';

describe('ilość w pozycji zakupów (D77)', () => {
  it.each([
    ['mleko 2', 'mleko', '2'],
    ['2 mleka', 'mleka', '2'],
    ['2x mleko', 'mleko', '×2'],
    ['jabłka 1,5 kg', 'jabłka', '1,5 kg'],
    ['jabłka 1.5kg', 'jabłka', '1,5 kg'],
    ['1 kg ziemniaków', 'ziemniaków', '1 kg'],
    ['jajka x10', 'jajka', '×10'],
    ['jajka x 10', 'jajka', '×10'],
    ['jajka 10x', 'jajka', '×10'],
    ['woda 6 szt.', 'woda', '6 szt.'],
    ['ser 20 dag', 'ser', '20 dag'],
    ['śmietana 200 ML', 'śmietana', '200 ml'],
    ['Cola 0,5', 'Cola 0,5', null],
    ['mleko 3,2%', 'mleko 3,2%', null],
    ['chleb', 'chleb', null],
    ['7 days', 'days', '7'],
    ['bułki 100', 'bułki 100', null],
    ['  masło  ', 'masło', null],
    ['2', '2', null],
  ])('„%s” → %s · %s', (title, name, qty) => {
    expect(parseQuantity(title)).toEqual({ name, qty });
  });
});
