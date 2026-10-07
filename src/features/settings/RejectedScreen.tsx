/** Zmiany odrzucone przez serwer (sync_push: status rejected) — serwer ma ostatnie słowo, nic nie ginie po cichu. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';

import { useAppData } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import type { Op } from '../../domain/sync-engine/client';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Screen, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Props = NativeStackScreenProps<RootStackParams, 'Rejected'>;

/** Kod błędu serwera → opis. Kody z migracji SQL (np. „forbidden:role”, „deleted:list”, „cycle”). */
export function rejectionReason(code: string): string {
  const head = code.split(':')[0];
  if (head === 'forbidden') return strings['rejected.code.forbidden'];
  if (head === 'deleted' || head === 'not_found') return strings['rejected.code.deleted'];
  if (head === 'cycle') return strings['rejected.code.cycle'];
  if (head === 'depth_exceeded') return strings['rejected.code.depth'];
  return strings['rejected.code.other'];
}

export function describeOp(op: Op): string {
  const verb = strings[`rejected.op.${op.kind}`];
  if (op.kind === 'cmd') return `${verb}: ${op.cmd}`;
  const set = op.kind === 'create' || op.kind === 'patch' ? op.set : {};
  const label = (set.title ?? set.name ?? set.display_name) as string | undefined;
  return label ? `${verb}: „${label}”` : verb;
}

export function RejectedScreen({ navigation }: Props) {
  const { state } = useAppData();
  const { c } = useTheme();
  return (
    <Screen testID="screen-rejected">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['rejected.title']}</Title>
      {state.rejected.length === 0 ? <Body muted>{strings['rejected.empty']}</Body> : <Body muted>{strings['rejected.info']}</Body>}
      {[...state.rejected].reverse().map((r) => (
        <View key={r.op.seq} style={{ padding: 14, gap: 4, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
          <Body>{describeOp(r.op)}</Body>
          <Body muted>{rejectionReason(r.code)}</Body>
        </View>
      ))}
    </Screen>
  );
}
