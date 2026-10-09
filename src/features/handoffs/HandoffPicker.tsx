/** Wybór osoby, której przekazuję odpowiedzialność (D70): dorośli z kontem w grupie. */

import type { Member } from '../../domain/views';
import { strings } from '../../i18n/strings.pl';
import { Body, Button, Card, CardTitle } from '../../ui/components';

export function HandoffPicker({ targets, onPick, onCancel, children }: { targets: Member[]; onPick: (m: Member) => void; onCancel: () => void; children?: React.ReactNode }) {
  return (
    <Card kind="panel" testID="handoff-picker">
      <CardTitle>
        {strings['handoff.pickTitle']}
      </CardTitle>
      <Body muted>{strings['handoff.pickInfo']}</Body>
      {children}
      {targets.length === 0 ? <Body muted>{strings['handoff.noTargets']}</Body> : null}
      {targets.map((m) => (
        <Button key={m.member_id} kind="secondary" label={strings['handoff.to'](m.display_name)} onPress={() => onPick(m)} />
      ))}
      <Button kind="secondary" label={strings['common.cancel']} onPress={onCancel} />
    </Card>
  );
}
