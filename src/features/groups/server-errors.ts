/**
 * Błąd operacji serwerowej w grupach (tworzenie, dołączanie, zaproszenia, kosz, przekazanie własności) jako tekst
 * dla osoby. Serwer zgłasza kody z migracji (`invite_*`, `forbidden…`, `deleted:…`, `invalid_member`,
 * `not_authenticated`) albo komunikat Postgresa (ograniczenie długości: „violates check constraint”). Nieznany wyjątek
 * i błąd sieci to brak internetu — tak samo jak w pętli synchronizacji (errorKind, src/sync/transport.ts).
 * Audyt 2 (R-38): dotąd wszystko poza `invite_*` kończyło się „Ta czynność wymaga internetu”.
 */
import { config } from '../../config';
import { strings } from '../../i18n/strings.pl';
import { TransportError } from '../../sync/transport';

/**
 * `owner` — czy to ja jestem właścicielem grupy (rada przy limicie zaproszeń: zmianę ID grupy robi tylko on; audyt 3,
 * N-163). Bez podania — jak u administratora.
 */
export function groupErrorText(e: unknown, ctx: { owner?: boolean } = {}): string {
  const m = e instanceof Error ? e.message : '';
  if (m === 'rate_limited') return strings['invite.rateLimited'];
  if (m === 'invite_expired') return strings['invite.expired'];
  if (m === 'invite_revoked') return strings['invite.revoked'];
  if (m === 'invite_used_up') return strings['invite.usedUp'];
  if (m === 'invite_removed') return strings['invite.removed'];
  if (m === 'invite_child_account') return strings['invite.childAccount'];
  if (m === 'limit:groups') return strings['groups.error.limitGroups'](config.quotas.SHARED_GROUPS);
  if (m === 'limit:group_rows' || m === 'limit:group_size') return strings['groups.error.groupFull'];
  if (m === 'limit:invites') return strings['groups.error.limitInvites'](config.quotas.ACTIVE_INVITES, ctx.owner === true);
  if (m.startsWith('invite_')) return strings['invite.invalid'];
  if (m === 'not_authenticated' || (e instanceof TransportError && e.kind === 'auth')) return strings['groups.error.session'];
  // revoke_invite zgłasza not_found także wtedy, gdy nie mam już roli owner/admin (np. odebrano mi ją w trakcie; N-163).
  if (m.startsWith('forbidden') || m === 'not_found') return strings['groups.error.forbidden'];
  if (m === 'deleted:expired') return strings['groups.error.expired'](config.sync.TOMBSTONE_DAYS);
  if (m.startsWith('deleted')) return strings['groups.error.trashed'];
  if (m === 'invalid_member') return strings['groups.error.member'];
  if (m.includes('violates check constraint')) return strings['groups.error.tooLong'];
  return e instanceof TransportError && e.kind === 'server' ? strings['common.error'] : `${strings['common.error']} ${strings['common.offlineOnly']}`;
}
