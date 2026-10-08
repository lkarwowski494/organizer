/** Moje grupy: osobista i wspólne, z kolorem linii; nowa grupa i dołączenie z linku; kosz grup (D54). */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import { groupsView, type TrashedGroup, trashedGroups } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Button, NavRow, Screen, SectionTitle, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useUndo } from '../../ui/undo';
import { absoluteDay } from './dates';
import { groupErrorText } from './server-errors';

export function GroupsScreen() {
  const { userId, account, store, nowMs } = useServices();
  const { tables, today } = useAppData();
  const { c, font, size } = useTheme();
  const undo = useUndo();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const groups = useMemo(() => groupsView(tables, userId), [tables, userId]);
  // Przywrócona na serwerze znika z kosza od razu, nie dopiero po pobraniu (żeby nie przywracać drugi raz). Pamiętamy
  // datę usunięcia: grupa wrzucona do kosza ponownie ma nową i znów jest w koszu.
  const [restored, setRestored] = useState<ReadonlyMap<string, string | null>>(new Map());
  const trash = useMemo(() => trashedGroups(tables, userId, nowMs()).filter((g) => restored.get(g.id) !== g.deleted_at), [tables, userId, nowMs, restored]);
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
  const restore = async (g: TrashedGroup) => {
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

  return (
    <Screen testID="screen-groups">
      <Title>{strings['groups.title']}</Title>
      <View style={{ gap: 10 }}>
        {groups.map((g) => (
          <NavRow
            key={g.id}
            testID={`group-${g.id}`}
            title={g.kind === 'personal' ? strings['groups.personal'] : g.name}
            subtitle={`${strings['groups.members'](g.memberCount)} · ${strings[`groups.role.${g.me.role}`]}`}
            line={g.line}
            onPress={() => nav.navigate('Group', { groupId: g.id })}
          />
        ))}
      </View>
      <Button label={strings['groups.new']} onPress={() => nav.navigate('NewGroup')} />
      <Button kind="secondary" label={strings['groups.join']} onPress={() => nav.navigate('Invite', {})} />
      <Button kind="secondary" label={strings['settings.open']} onPress={() => nav.navigate('Settings')} />
      {error ? <Text accessibilityRole="alert" style={{ fontFamily: font.text700, color: c.danger }}>{error}</Text> : null}
      {trash.length ? (
        <View style={{ gap: 8 }}>
          <SectionTitle>{strings['groups.trash']}</SectionTitle>
          {trash.map((g) => (
            <View key={g.id} testID={`trash-${g.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
              {g.canRestore ? (
                <>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontFamily: font.text600, fontSize: size.BODY, color: c.ink }}>{g.name}</Text>
                    <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{strings['groups.trashLeft'](g.daysLeft)}</Text>
                  </View>
                  <Button kind="secondary" label={strings['groups.restoreButton']} a11yLabel={strings['groups.restore'](g.name)} testID={`restore-${g.id}`} onPress={() => void restore(g)} />
                </>
              ) : (
                // Decyzja właściciela z 8.10.2026 (PWD-21 A): członek widzi, że grupa jest w koszu i do kiedy wróci.
                <Text style={{ flex: 1, fontFamily: font.text400, fontSize: size.BODY, color: c.inkMuted }}>{strings['groups.trashedInfo'](g.name, absoluteDay(g.restoreUntilMs, today))}</Text>
              )}
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
