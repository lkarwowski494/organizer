/**
 * Operacje na koncie i grupach, które wymagają serwera (nie idą przez kolejkę offline): logowanie, grupy (tworzenie,
 * kody i ID grupy, usunięcie i przywrócenie, przekazanie własności), zaproszenia, powiadomienia, zgłoszenia błędów
 * i uwag, usunięcie konta — pełna lista to metody `AccountApi` niżej.
 * Implementacja: src/sync/supabase.ts; w testach ekranów — atrapa.
 */
/** Kod do ID grupy (D92–D94): 6 cyfr, 24 h, dla wielu osób. */
export type JoinInvite = { inviteId: string; joinId: string; code: string; url: string; expiresAt: string };

/**
 * Wynik dołączenia. `alreadyMember` — już jestem w tej grupie (przyjęcie bez skutku, rola bez zmian, audyt 3 N-157):
 * moja rola i rola kodu; `null`, gdy serwer ich nie podał (wersja sprzed migracji 20261010100000).
 */
export type JoinResult = { groupId: string; alreadyMember?: { role: string | null; inviteRole: string | null } };

export type Invite = { inviteId: string; token: string; url: string; expiresAt: string; maxUses: number };

/** Zgłoszenie błędu (D80): bez treści z tabel. */
export type ClientError = { kind: 'crash' | 'error' | 'diagnostic'; message: string; stack: string | null; screen: string | null; appVersion: string };

/**
 * Błąd logowania albo usunięcia konta, który ekran rozróżnia (audyt 3, N-72, N-73):
 * `canceled` — osoba zamknęła okno Apple (bez komunikatu); `network` — żądanie nie doszło do serwera;
 * `apple_mismatch` — potwierdzenie innym Apple ID niż to, którym logowano się do Organizera; `apple_unavailable` — Apple
 * nie odpowiada; `failed` — każdy inny błąd.
 */
export type AccountErrorCode = 'canceled' | 'network' | 'apple_mismatch' | 'apple_unavailable' | 'failed';
export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}
export const accountErrorCode = (e: unknown): AccountErrorCode => (e instanceof AccountError ? e.code : 'failed');

export type DeleteAccountOptions = {
  /** „Usuń też moje wpisy w grupach” (audyt 3, N-71, decyzja Q5 C). */
  deleteEntries?: boolean;
  /** Po udanym usunięciu na serwerze, przed końcem sesji (sprzątanie telefonu, M-64). */
  beforeSignOut?: () => Promise<void>;
};

export interface AccountApi {
  /** W becie jedyny sposób logowania (D177). Błędy: `AccountError`. */
  signInWithApple(): Promise<void>;
  /** Wylogowanie tylko tego telefonu (D176); bez sieci token push zdejmie później `finishSignOut`. */
  signOut(): Promise<void>;
  /**
   * Zaległe sprzątanie po wylogowaniu bez sieci: wyrejestrowanie tokenu push starą sesją. Bez wyjątków — co się nie
   * uda, zostaje na następny raz.
   */
  finishSignOut(): Promise<void>;
  /**
   * Usunięcie konta (D49): serwer przekazuje grupy i zaciera imię w historii; z `deleteEntries` moje wpisy w grupach
   * wspólnych idą do kosza. Błędy: `AccountError`.
   */
  deleteAccount(opts?: DeleteAccountOptions): Promise<void>;
  /** Moje imię w profilu konta (D100); członkostwa zmienia kolejka (domain/views/my-name). */
  setMyName(name: string): Promise<void>;
  createGroup(a: { groupId: string; name: string; ownerMemberId: string; displayName: string }): Promise<void>;
  createInvite(groupId: string, role: 'member' | 'admin'): Promise<Invite>;
  /** `displayName` null — imię zostaje po stronie serwera (profil konta, dawne imię w grupie, imię profilu dziecka; N-164). */
  acceptInvite(token: string, displayName: string | null): Promise<JoinResult>;
  revokeInvite(inviteId: string): Promise<void>;
  /**
   * Kod do ID grupy (owner/admin): bieżący ważny kod tej roli albo nowy, gdy ważnego nie ma — jeden aktywny kod na grupę
   * i rolę (decyzja właściciela z 8.10.2026, PW-41 A). Po usunięciu kogoś z grupy nowy (usunięta osoba wraca tylko kodem
   * wystawionym później); starszy działa dalej dla innych do wygaśnięcia (audyt 3, N-38).
   */
  createJoinCode(groupId: string, role: 'member' | 'admin'): Promise<JoinInvite>;
  /** „Nowy kod”: kolejny kod tej roli; poprzedni przestaje działać (PW-41 A). */
  renewJoinCode(groupId: string, role: 'member' | 'admin'): Promise<JoinInvite>;
  /**
   * „Połącz z kontem dziecka” (owner/admin; decyzja właściciela z 8.10.2026, PW-14 B): jednorazowy kod przypięty do profilu
   * dziecka bez konta — dziecko dołącza nim jak zwykłym kodem i staje się tym profilem. Bieżący ważny kod albo nowy.
   */
  createChildCode(memberId: string): Promise<JoinInvite>;
  /** „Nowy kod” przy profilu dziecka; poprzedni przestaje działać. */
  renewChildCode(memberId: string): Promise<JoinInvite>;
  /**
   * Dołączenie ID + kod. Błędy (komunikat): invite_invalid, invite_expired, invite_revoked, invite_used_up, invite_removed,
   * invite_child_account (kod profilu dziecka na koncie, które jest albo było w grupie), rate_limited.
   */
  joinGroup(joinId: string, code: string, displayName: string | null): Promise<JoinResult>;
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
  /**
   * D159: poproś o ciche powiadomienia dla członków grup po moich zmianach (odświeżenie ich przypomnień); `retry` — tylko
   * zaległe. Wynik: za ile sekund ponowić (przerwa u odbiorców), null — nic nie czeka.
   */
  notifyGroups(r: { groups: string[]; retry: boolean }): Promise<{ retryInSec: number | null }>;
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
