/**
 * Kosz na ekranie Grupy (D54 dla grup; decyzja właściciela z 8.10.2026, audyt 2: PW-4 A, M-34 — D151): usunięte grupy,
 * listy, zadania, pozycje zakupów, wydarzenia i osoby z ostatnich config.sync.TOMBSTONE_DAYS dni, w sekcjach według
 * rodzaju, każda z „Przywróć”. Przywrócenie listy, zadania, wydarzenia i osoby to zwykła zmiana (działa bez internetu,
 * serwer sprawdza prawa — odrzuconą pokaże „Serwer nie przyjął…”); grupa wraca przez serwer (RPC). Po przywróceniu
 * pasek „Przywrócono: … · Cofnij”, jak po usunięciu.
 */
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import { config } from '../../config';
import { type TrashedGroup, trashedGroups } from '../../domain/views';
import type { NewOp } from '../../domain/sync-engine/client';
import { TRASH_KINDS, type TrashEntry, type TrashKind, trashView } from '../../domain/views/trash';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, ErrorText, SectionTitle } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';
import { absoluteDay } from './dates';
import { groupErrorText } from './server-errors';

function TrashRow({ id, title, meta, onRestore, restoreLabel }: { id: string; title: string; meta: string; onRestore?: () => void; restoreLabel?: string }) {
  const { c, font, size } = useTheme();
  return (
    <View testID={`trash-${id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.text600, fontSize: size.BODY, color: c.ink }}>{title}</Text>
        <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{meta}</Text>
      </View>
      {onRestore ? <Button kind="secondary" label={strings['groups.restoreButton']} a11yLabel={restoreLabel} testID={`restore-${id}`} onPress={onRestore} /> : null}
    </View>
  );
}

export function TrashSection() {
  const { userId, account, store, nowMs } = useServices();
  const { tables, today } = useAppData();
  const { c, font } = useTheme();
  const undo = useUndo();
  // Przywrócona na serwerze grupa znika z kosza od razu, nie dopiero po pobraniu (żeby nie przywracać drugi raz). Pamiętamy
  // datę usunięcia: grupa wrzucona do kosza ponownie ma nową i znów jest w koszu.
  const [restored, setRestored] = useState<ReadonlyMap<string, string | null>>(new Map());
  const groups = useMemo(() => trashedGroups(tables, userId, nowMs()).filter((g) => restored.get(g.id) !== g.deleted_at), [tables, userId, nowMs, restored]);
  const items = useMemo(() => trashView(tables, userId, nowMs()), [tables, userId, nowMs]);
  const [open, setOpen] = useState<readonly TrashKind[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mark = (g: TrashedGroup, on: boolean) =>
    setRestored((r) => {
      const next = new Map(r);
      if (on) next.set(g.id, g.deleted_at);
      else next.delete(g.id);
      return next;
    });

  // Audyt 2 (G-38, A-49, R-18): przywrócenie to przycisk w wierszu kosza (nie wiersz ze strzałką), z komunikatem
  // błędu i paskiem „Przywrócono: …” z „Cofnij” (z powrotem do kosza, jak usunięcie — D54).
  const restoreGroup = async (g: TrashedGroup) => {
    setError(null);
    try {
      await account.restoreGroup(g.id);
    } catch (e) {
      return setError(groupErrorText(e));
    }
    mark(g, true);
    store.refresh();
    undo.show(strings['groups.restored'](g.name), () => {
      account.deleteGroup(g.id).then(
        () => (mark(g, false), store.refresh()),
        (e: unknown) => setError(groupErrorText(e)),
      );
    });
  };
  const restore = (e: TrashEntry) => {
    const ops: NewOp[] = [{ kind: 'restore', entity: e.entity, id: e.id }];
    store.dispatch(ops);
    undo.show(strings['groups.restored'](e.title), { ops: [{ kind: 'delete', entity: e.entity, id: e.id }] }, { changed: ops });
  };
  const meta = (e: TrashEntry) =>
    [e.groupName, e.listName, e.kind === 'list' && e.tasks > 0 ? strings['trash.withTasks'](e.tasks, e.shopping) : null, strings['groups.trashLeft'](e.daysLeft)].filter(Boolean).join(' · ');

  if (groups.length === 0 && items.length === 0) return null;
  return (
    <View testID="trash" style={{ gap: 8 }}>
      <SectionTitle>{strings['groups.trash']}</SectionTitle>
      <Body muted>{strings['trash.info'](config.sync.TOMBSTONE_DAYS)}</Body>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {groups.length ? (
        <View testID="trash-group" style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ fontFamily: font.text700, color: c.ink }}>{strings['trash.kind.group']}</Text>
          {groups.map((g) =>
            g.canRestore ? (
              <TrashRow key={g.id} id={g.id} title={g.name} meta={strings['groups.trashLeft'](g.daysLeft)} restoreLabel={strings['groups.restore'](g.name)} onRestore={() => void restoreGroup(g)} />
            ) : (
              // Decyzja właściciela z 8.10.2026 (PWD-21 A): członek widzi, że grupa jest w koszu i do kiedy wróci.
              <TrashRow key={g.id} id={g.id} title={g.name} meta={strings['groups.trashedInfo'](g.name, absoluteDay(g.restoreUntilMs, today))} />
            ),
          )}
        </View>
      ) : null}
      {TRASH_KINDS.map((k) => {
        const all = items.filter((e) => e.kind === k);
        if (all.length === 0) return null;
        const expanded = open.includes(k);
        const shown = expanded ? all : all.slice(0, config.TRASH_PREVIEW);
        return (
          <View key={k} testID={`trash-${k}`} style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.text700, color: c.ink }}>{strings[`trash.kind.${k}`]}</Text>
            {shown.map((e) => (
              <TrashRow key={e.id} id={e.id} title={e.title} meta={meta(e)} restoreLabel={strings['groups.restore'](e.title)} onRestore={() => restore(e)} />
            ))}
            {all.length > config.TRASH_PREVIEW ? (
              <Button kind="secondary" label={expanded ? strings['trash.showLess'] : strings['trash.showAll'](all.length)} testID={`trash-more-${k}`} onPress={() => setOpen(expanded ? open.filter((x) => x !== k) : [...open, k])} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
