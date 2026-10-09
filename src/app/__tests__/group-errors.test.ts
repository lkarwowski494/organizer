/** Komunikaty błędów operacji serwerowych w grupach według kodu serwera (audyt 2, R-38). */
import { groupErrorText } from '../../features/groups/server-errors';
import { strings } from '../../i18n/strings.pl';
import { TransportError } from '../../sync/transport';

const offline = `${strings['common.error']} ${strings['common.offlineOnly']}`;

describe('groupErrorText', () => {
  it.each([
    ['rate_limited', strings['invite.rateLimited']],
    ['invite_expired', strings['invite.expired']],
    ['invite_revoked', strings['invite.revoked']],
    ['invite_used_up', strings['invite.usedUp']],
    ['invite_removed', strings['invite.removed']],
    ['invite_child_account', strings['invite.childAccount']],
    ['limit:groups', 'Możesz należeć najwyżej do 50 grup wspólnych (liczą się też grupy w koszu). Opuść albo usuń grupę, której już nie używasz.'],
    ['limit:invites', strings['groups.error.limitInvites'](20)],
    // Audyt 3 (N-2, Q12 część 3 A): dołączenie do pełnej grupy.
    ['limit:group_rows', 'Ta grupa ma już najwięcej spraw, ile może mieć — nie da się teraz do niej dołączyć. Poproś kogoś z grupy o usunięcie niepotrzebnych spraw.'],
    ['limit:group_size', 'Ta grupa ma już najwięcej spraw, ile może mieć — nie da się teraz do niej dołączyć. Poproś kogoś z grupy o usunięcie niepotrzebnych spraw.'],
    ['invite_invalid', strings['invite.invalid']],
    ['not_authenticated', strings['groups.error.session']],
    ['forbidden', strings['groups.error.forbidden']],
    ['forbidden:role', strings['groups.error.forbidden']],
    ['deleted:expired', 'Grupa była w koszu dłużej niż 30 dni — nie da się jej już przywrócić.'],
    ['deleted:group', strings['groups.error.trashed']],
    ['invalid_member', strings['groups.error.member']],
    ['new row for relation "group_members" violates check constraint "group_members_display_name_check"', strings['groups.error.tooLong']],
  ])('kod serwera %s', (code, text) => {
    expect(groupErrorText(new TransportError('server', code))).toBe(text);
    // Ten sam kod w zwykłym wyjątku (atrapy, stare ścieżki) — tak samo.
    expect(groupErrorText(new Error(code))).toBe(text);
  });

  it('sesja, nieznany błąd serwera, brak sieci i wyjątek bez komunikatu', () => {
    expect(groupErrorText(new TransportError('auth', 'JWT expired'))).toBe(strings['groups.error.session']);
    expect(groupErrorText(new TransportError('server', 'coś nowego'))).toBe(strings['common.error']);
    expect(groupErrorText(new TransportError('network', 'Network request failed'))).toBe(offline);
    expect(groupErrorText(new Error('Network request failed'))).toBe(offline);
    expect(groupErrorText('tekst')).toBe(offline);
    expect(groupErrorText(undefined)).toBe(offline);
  });
});
