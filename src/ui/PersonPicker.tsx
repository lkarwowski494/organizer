/**
 * Wybór osoby (decyzja właściciela 8.10.2026, PWD-30 A / audyt 2 M-299): do config.people.PICKER_SEARCH_FROM opcji — ten
 * sam rząd przycisków co wszędzie (Segmented); w dużej grupie (klasa, znajomi) — wybrana osoba z „Zmień”, a po dotknięciu
 * pole wyszukiwania i przyciski tylko pasujących osób. Pierwsza opcja (np. „Nikt konkretny”) jest zawsze widoczna.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { config } from '../config';
import { strings } from '../i18n/strings.pl';
import { Body, Button, Field, Segmented } from './components';

/** Porównanie bez wielkości liter i polskich znaków („Łukasz” ~ „lukasz”). */
export const searchKey = (s: string) =>
  s
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

export function PersonPicker<T extends string>({ value, options, onChange, label, testID }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; testID?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  if (options.length < config.people.PICKER_SEARCH_FROM) return <Segmented label={label} value={value} options={options} onChange={onChange} />;
  const current = options.find((o) => o.value === value) ?? options[0]!;
  if (!open) return <Button kind="secondary" label={strings['people.change'](label, current.label)} testID={testID ? `${testID}-change` : undefined} onPress={() => setOpen(true)} />;
  const q = searchKey(query.trim());
  const [first, ...rest] = options;
  const shown = [first!, ...rest.filter((o) => q === '' || searchKey(o.label).includes(q))];
  return (
    <View style={{ gap: 8 }}>
      <Field label={strings['people.search']} value={query} onChangeText={setQuery} autoFocus autoCorrect={false} returnKeyType="search" testID={testID ? `${testID}-search` : undefined} />
      {shown.length === 1 && q !== '' ? <Body muted>{strings['people.none']}</Body> : null}
      <Segmented
        label={label}
        value={value}
        options={shown}
        onChange={(v) => {
          onChange(v);
          setOpen(false);
          setQuery('');
        }}
      />
    </View>
  );
}
