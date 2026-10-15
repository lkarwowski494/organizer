/**
 * Testy kontraktowe wzorców interakcji (docs/32-wzorce-interakcji.md).
 * Pilnują spójności interfejsu, wzorców przycisków, etykiet dostępności i braku zakazanych symboli.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strings } from '../../i18n/strings.pl';

const root = join(__dirname, '../../..');
const srcDir = join(root, 'src');

function walk(dir: string, filter: (f: string) => boolean): string[] {
  let res: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.temp' && entry.name !== '.git') {
        res = res.concat(walk(full, filter));
      }
    } else if (filter(entry.name)) {
      res.push(full);
    }
  }
  return res;
}

describe('Wzorce interakcji — standardy interfejsu (docs/32-wzorce-interakcji.md)', () => {
  test('ekrany tworzenia i edycji używają CancelButton', () => {
    const screens = [
      'src/features/lists/AddTaskScreen.tsx',
      'src/features/events/EventEditScreen.tsx',
      'src/features/lists/NewListScreen.tsx',
      'src/features/groups/NewGroupScreen.tsx',
    ];
    for (const rel of screens) {
      const code = readFileSync(join(root, rel), 'utf8');
      expect(code).toContain('CancelButton');
      expect(code).toMatch(/testID="[a-z0-9-]+-cancel"/);
    }
  });

  test('formularze nie używają gołego „Zamknij” ani „Wróć” jako przycisku anulowania szkicu', () => {
    const screens = [
      'src/features/lists/AddTaskScreen.tsx',
      'src/features/events/EventEditScreen.tsx',
      'src/features/lists/NewListScreen.tsx',
      'src/features/groups/NewGroupScreen.tsx',
    ];
    for (const rel of screens) {
      const code = readFileSync(join(root, rel), 'utf8');
      expect(code).not.toContain("label={strings['common.close']}");
      expect(code).not.toContain("label={strings['common.back']}");
    }
  });

  test('żaden komponent ani ekran nie używa accessibilityRole="link"', () => {
    const tsFiles = walk(srcDir, (f) => f.endsWith('.ts') || f.endsWith('.tsx')).filter((f) => !f.includes('__tests__'));
    const linkOccurrences: string[] = [];
    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('accessibilityRole="link"')) {
        linkOccurrences.push(file);
      }
    }
    expect(linkOccurrences).toEqual([]);
  });

  test('żaden plik kodu nie używa zakazanych wariantów daszków/szewronów (⌃, ⌄, ▴)', () => {
    const tsFiles = walk(srcDir, (f) => f.endsWith('.ts') || f.endsWith('.tsx')).filter((f) => !f.includes('__tests__'));
    const forbidden = ['\u2303', '\u2335', '\u25B4']; // ⌃, ⌄, ▴
    const badHits: { file: string; char: string }[] = [];
    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf8');
      for (const char of forbidden) {
        if (content.includes(char)) {
          badHits.push({ file, char });
        }
      }
    }
    expect(badHits).toEqual([]);
  });

  test('potwierdzenia Alert.alert używają przycisku Anuluj ze stylem cancel', () => {
    const tsFiles = walk(join(srcDir, 'features'), (f) => f.endsWith('.ts') || f.endsWith('.tsx'))
      .concat(walk(join(srcDir, 'app'), (f) => f.endsWith('.ts') || f.endsWith('.tsx')))
      .filter((f) => !f.includes('__tests__'));

    const alertFiles = tsFiles.filter((file) => readFileSync(file, 'utf8').includes('Alert.alert('));
    expect(alertFiles.length).toBeGreaterThan(0);
    for (const file of alertFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content).toContain("style: 'cancel'");
    }
  });

  test('słownik terminów UI w strings.pl.ts zawiera standardowe etykiety interakcji', () => {
    expect(strings['common.cancel']).toBe('Anuluj');
    expect(strings['common.back']).toBe('Wróć');
    expect(strings['common.close']).toBe('Zamknij');
    expect(strings['undo.action']).toBe('Cofnij');
    expect(strings['calendar.addTask']).toBe('Dodaj zadanie na ten dzień');
    expect(strings['event.cancelledSeriesDates']).toBe('Odwołane terminy w tej serii');
  });

  test('brak ogólnikowych i pustych komunikatów błędów „Błąd” bez kontekstu', () => {
    const errorStrings = Object.entries(strings)
      .filter(([key, val]) => key.includes('error') && typeof val === 'string')
      .map(([, val]) => val as string);

    expect(errorStrings.length).toBeGreaterThan(0);
    for (const val of errorStrings) {
      expect(val.trim()).not.toBe('Błąd');
      expect(val.trim()).not.toBe('Nie udało się');
    }
  });

  test('EventScreen zawiera obsługę i przywracanie odwołanych terminów serii', () => {
    const code = readFileSync(join(srcDir, 'features/events/EventScreen.tsx'), 'utf8');
    expect(code).toContain('cancelledOverrides');
    expect(code).toContain("strings['event.cancelledSeriesDates']");
    expect(code).toContain('restoreOccurrence');
  });
});
