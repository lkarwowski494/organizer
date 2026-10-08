/**
 * Operacje na koncie i grupach, które wymagają serwera (nie idą przez kolejkę offline):
 * logowanie, tworzenie grupy (RPC create_group), zaproszenia (create/accept/revoke_invite), usunięcie konta.
 * Implementacja: src/sync/supabase.ts; w testach ekranów — atrapa.
 */
/** Kod do ID grupy (D92–D94): 6 cyfr, 24 h, dla wielu osób. */
export type JoinInvite = { inviteId: string; joinId: string; code: string; url: string; expiresAt: string };

export type Invite = { inviteId: string; token: string; url: string; expiresAt: string; maxUses: number };

/** Zgłoszenie błędu (D80): bez treści z tabel. */
export type ClientError = { kind: 'crash' | 'error' | 'diagnostic'; message: string; stack: string | null; screen: string | null; appVersion: string };

export interface AccountApi {
  signInWithApple(): Promise<void>;
  /** Magic link (D5): wysyła e-mail z linkiem io.github.lkarwowski494.organizer://… */
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Usunięcie konta (D49): serwer przekazuje grupy i zaciera imię w historii. */
  deleteAccount(): Promise<void>;
  /** Moje imię w profilu konta (D100); członkostwa zmienia kolejka (domain/views/my-name). */
  setMyName(name: string): Promise<void>;
  createGroup(a: { groupId: string; name: string; ownerMemberId: string; displayName: string }): Promise<void>;
  createInvite(groupId: string, role: 'member' | 'admin'): Promise<Invite>;
  acceptInvite(token: string, displayName: string): Promise<{ groupId: string }>;
  revokeInvite(inviteId: string): Promise<void>;
  /**
   * Kod do ID grupy (owner/admin): bieżący ważny kod tej roli albo nowy, gdy ważnego nie ma — jeden aktywny kod na grupę
   * i rolę (decyzja właściciela z 8.10.2026, PW-41 A).
   */
  createJoinCode(groupId: string, role: 'member' | 'admin'): Promise<JoinInvite>;
  /** „Nowy kod”: kolejny kod tej roli; poprzedni przestaje działać (PW-41 A). */
  renewJoinCode(groupId: string, role: 'member' | 'admin'): Promise<JoinInvite>;
  /** Dołączenie ID + kod. Błędy (komunikat): invite_invalid, invite_expired, invite_revoked, invite_used_up, rate_limited. */
  joinGroup(joinId: string, code: string, displayName: string): Promise<{ groupId: string }>;
  /** Nowe ID grupy (owner); wszystkie kody na stare ID przestają działać. */
  rotateJoinId(groupId: string): Promise<string>;
  /** Kosz grupy (D54): tylko właściciel; przywrócenie w ciągu config.sync.TOMBSTONE_DAYS dni. */
  deleteGroup(groupId: string): Promise<void>;
  restoreGroup(groupId: string): Promise<void>;
  /** Przekazanie własności dorosłemu z kontem (D55). */
  transferOwnership(groupId: string, memberId: string): Promise<void>;
  /** Token APNs tego telefonu (D70, push o przekazaniach). */
  registerPushToken(token: string, env: 'sandbox' | 'production'): Promise<void>;
  /** Poproś serwer o powiadomienie drugiej strony przekazania (funkcja notify-handoff; serwer decyduje, czy wysłać). */
  notifyHandoff(handoffId: string): Promise<void>;
  /** Poproś o powiadomienie osoby, której przypisałem zadanie albo zakupy (D81) — po id wpisu aktywności. */
  notifyAssignment(activityId: string): Promise<void>;
  /** Grupy wyciszone przeze mnie (D81: bez powiadomień o przypisaniach). */
  getPushMutes(): Promise<string[]>;
  setPushMute(groupId: string, muted: boolean): Promise<void>;
  /** Błąd z telefonu (D80) — serwer liczy limit dzienny; nieudane zgłoszenie nie jest zgłaszane dalej. */
  reportError(e: ClientError): Promise<void>;
  /** Opinia z Ustawień (D80). Błąd `rate_limited`, gdy dzienny limit wyczerpany. */
  sendFeedback(a: { message: string; screen: string | null; appVersion: string }): Promise<void>;
}
