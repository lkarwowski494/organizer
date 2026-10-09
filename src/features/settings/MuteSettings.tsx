/** Wyciszenie powiadomień o przypisaniach per grupa (D81). Stan na serwerze (push_mutes) — potrzebny internet. */
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useAppData, useServices } from '../../app/context';
import { groupsView } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Body, SectionTitle, SwitchRow } from '../../ui/components';

export function MuteSettings() {
  const { account, userId } = useServices();
  const { tables } = useAppData();
  const shared = groupsView(tables, userId).filter((g) => g.kind === 'shared');
  const [muted, setMuted] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    account.getPushMutes().then(
      (m) => live && setMuted(m),
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
  }, [account]);
  if (shared.length === 0) return null;
  const toggle = (groupId: string, mute: boolean) => {
    const before = muted ?? [];
    setMuted(mute ? [...before, groupId] : before.filter((g) => g !== groupId));
    account.setPushMute(groupId, mute).catch(() => (setMuted(before), setError(true)));
  };
  return (
    <View testID="mute-settings" style={{ gap: 10 }}>
      <SectionTitle>{strings['mutes.section']}</SectionTitle>
      <Body muted>{strings['mutes.info']}</Body>
      {muted === null && !error ? <Body muted>{strings['app.loading']}</Body> : null}
      {error ? <Body muted>{strings['mutes.error']}</Body> : null}
      {muted
        ? shared.map((g) => (
            // M-308 (PWD-39 A): przełącznik włączony = powiadomienia z grupy przychodzą.
            <SwitchRow key={g.id} label={g.name} value={!muted.includes(g.id)} onChange={(on) => toggle(g.id, !on)} testID={`switch-mute-${g.id}`} />
          ))
        : null}
    </View>
  );
}
