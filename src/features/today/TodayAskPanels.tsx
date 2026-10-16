import type React from 'react';

import type { QuickAnswers, QuickResolution, QuickTarget } from '../../domain/views/quick-target';
import { strings } from '../../i18n/strings.pl';
import { AskPanel } from '../../ui/AskPanel';

export function TodayAskPanels({
  ask,
  onProceed,
  onCancel,
  toShopping,
}: {
  ask: { r: Exclude<QuickResolution, { kind: 'ok' | 'noGroup' }>; answers: QuickAnswers } | null;
  onProceed: (answers: QuickAnswers) => void;
  onCancel: () => void;
  toShopping: (plain: QuickTarget | null, product: string, list: { id: string; name: string }) => void;
}) {
  if (!ask) return null;
  const { r, answers } = ask;

  if (r.kind === 'many') {
    return (
      <AskPanel
        testID="mention-choices"
        title={strings['mention.ask'](r.name)}
        options={r.targets.map((t) => ({ key: `${t.groupId}-${t.memberId}`, label: strings['mention.pick'](t.displayName, t.groupName), onPress: () => onProceed({ ...answers, person: t }) }))}
        onCancel={onCancel}
      />
    );
  }

  if (r.kind === 'unknown') {
    return (
      <AskPanel
        testID="mention-unknown"
        title={strings['mention.unknown'](r.name)}
        body={strings['mention.unknownInfo'](r.name)}
        options={[{ key: 'without', label: strings['mention.addWithout'], onPress: () => onProceed({ ...answers, skipMention: true }) }]}
        onCancel={onCancel}
      />
    );
  }

  if (r.kind === 'manyGroups') {
    return (
      <AskPanel
        testID="tag-choices"
        title={strings['tag.ask'](r.name)}
        options={r.groups.map((g) => ({ key: g.id, label: g.name, onPress: () => onProceed({ ...answers, group: g.id }) }))}
        onCancel={onCancel}
      />
    );
  }

  if (r.kind === 'childGroup') {
    return (
      <AskPanel
        testID="tag-child"
        title={strings['tag.child'](r.groups[0]!.name)}
        body={strings[r.groups.some((g) => g.list) ? 'tag.childInfo' : 'tag.childNoList']}
        options={r.groups.flatMap((g) => {
          return g.list ? [{ key: g.id, label: strings['quick.toShopping'](strings['quick.listInGroup'](g.list.name, g.name)), onPress: () => toShopping(null, r.body, g.list!) }] : [];
        })}
        onCancel={onCancel}
      />
    );
  }

  if (r.kind === 'unknownGroup') {
    return (
      <AskPanel
        testID="tag-unknown"
        title={strings['tag.unknown'](r.name)}
        body={strings['tag.unknownInfo'](r.name, r.chip.name)}
        options={[{ key: 'chip', label: strings['tag.addTo'](r.chip.name), onPress: () => onProceed({ ...answers, skipTag: true }) }]}
        onCancel={onCancel}
      />
    );
  }

  return null;
}
