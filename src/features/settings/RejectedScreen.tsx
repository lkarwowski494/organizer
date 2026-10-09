/** Zmiany odrzucone przez serwer (sync_push: status rejected) — serwer ma ostatnie słowo, nic nie ginie po cichu. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAppData, useServices } from '../../app/context';
import type { RootStackParams } from '../../app/routes';
import type { Op } from '../../domain/sync-engine/client';
import type { Tables } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { BackButton, Body, Button, Card, Screen, Title } from '../../ui/components';

type Props = NativeStackScreenProps<RootStackParams, 'Rejected'>;

/** Kod błędu serwera → opis. Kody z migracji SQL (np. „forbidden:role”, „deleted:list”, „cycle”). */
export function rejectionReason(code: string): string {
  const head = code.split(':')[0];
  // Kody z migracji 20261008280000_audit_fixes (audyt 8.10.2026).
  if (code === 'deleted:parent') return strings['rejected.code.parent'];
  // Audyt 3 (N-131): przywrócenie zadania przeniesionego do innej grupy (20261010060000_move_task_to_group).
  if (code === 'moved') return strings['rejected.code.moved'];
  if (head === 'stale') return strings['rejected.code.stale'];
  if (head === 'forbidden') return strings['rejected.code.forbidden'];
  if (head === 'deleted' || head === 'not_found') return strings['rejected.code.deleted'];
  if (head === 'cycle') return strings['rejected.code.cycle'];
  if (head === 'depth_exceeded') return strings['rejected.code.depth'];
  // Audyt 3 (N-2, Q12 część 3 A): limit grupy (migracja 20261010011000_write_limits).
  if (code === 'limit:group_rows') return strings['rejected.code.groupRows'];
  if (code === 'limit:group_size') return strings['rejected.code.groupSize'];
  // Audyt 2 (M-70): limity na konto (np. limit:groups przy dołączaniu z kolejki).
  if (head === 'limit') return strings['rejected.code.limit'];
  return strings['rejected.code.other'];
}

/** `t` — dane na telefonie: nazwa rzeczy przy zmianie, usunięciu i przywróceniu (audyt 2, M-137: „Usunięcie: „Mleko””). */
export function describeOp(op: Op, t: Tables = {}): string {
  const verb = strings[`rejected.op.${op.kind}`];
  if (op.kind === 'cmd') {
    if (op.cmd === 'move_task') return strings['rejected.cmd.move_task'];
    // Audyt 3 (N-12): przeniesienie do innej grupy jest jednym poleceniem — odrzucone w całości, oryginał zostaje.
    if (op.cmd === 'move_task_to_group') return strings['rejected.cmd.move_task_to_group'](String((op.args.tasks as { set: { title?: unknown } }[])[0]?.set.title ?? ''));
    if (op.cmd === 'unmove_task') return strings['rejected.cmd.unmove_task'](String(op.args.title ?? ''));
    // Audyt 2 (M-3): „to i następne” jest jednym poleceniem — odrzucone w całości, nazwa wydarzenia z polecenia.
    if (op.cmd === 'split_event') return strings['rejected.cmd.split_event'](String((op.args.set as { title?: unknown } | undefined)?.title ?? ''));
    if (op.cmd === 'end_series' || op.cmd === 'restore_series') return strings[`rejected.cmd.${op.cmd}`](String(op.args.title ?? ''));
    // Audyt 2 (M-111): stałe zakupy jako polecenia.
    if (op.cmd === 'staple_add') return `${strings['rejected.cmd.staple_add']}: „${String(op.args.name)}”`;
    if (op.cmd === 'staple_remove') return `${strings['rejected.cmd.staple_remove']}: „${(op.args.names as readonly unknown[]).join(', ')}”`;
    return verb;
  }
  const set = op.kind === 'create' || op.kind === 'patch' ? op.set : {};
  const row = t[op.entity]?.[op.id] ?? {};
  const label = (set.title ?? set.name ?? set.display_name ?? row.title ?? row.name ?? row.display_name) as string | undefined;
  // Audyt 2 (U-42): bez tytułu — czego dotyczy zmiana („Dodanie: obecność”).
  return label ? `${verb}: „${label}”` : `${verb}: ${strings['rejected.entity'](op.entity)}`;
}

export function RejectedScreen({ navigation }: Props) {
  const { state, tables } = useAppData();
  const { store } = useServices();
  return (
    <Screen testID="screen-rejected">
      <BackButton onPress={() => navigation.goBack()} />
      <Title>{strings['rejected.title']}</Title>
      {state.rejected.length === 0 ? <Body muted>{strings['rejected.empty']}</Body> : <Body muted>{strings['rejected.info']}</Body>}
      {[...state.rejected].reverse().map((r) => (
        <Card kind="panel" key={r.op.seq}>
          <Body>{describeOp(r.op, tables)}</Body>
          <Body muted>{rejectionReason(r.code)}</Body>
        </Card>
      ))}
      {/* D190: lista nie rośnie bez końca — przeczytane można wyczyścić (z telefonu też znikają). */}
      {state.rejected.length ? <Button kind="secondary" label={strings['rejected.clear']} testID="rejected-clear" onPress={() => store.clearRejected()} /> : null}
    </Screen>
  );
}
