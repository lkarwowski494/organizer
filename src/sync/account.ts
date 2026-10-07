/**
 * Operacje na koncie i grupach, które wymagają serwera (nie idą przez kolejkę offline):
 * logowanie, tworzenie grupy (RPC create_group), zaproszenia (create/accept/revoke_invite), usunięcie konta.
 * Implementacja: src/sync/supabase.ts; w testach ekranów — atrapa.
 */
export type Invite = { inviteId: string; token: string; url: string; expiresAt: string; maxUses: number };

export interface AccountApi {
  signInWithApple(): Promise<void>;
  /** Magic link (D5): wysyła e-mail z linkiem io.github.lkarwowski494.organizer://… */
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Usunięcie konta (D49): serwer przekazuje grupy i zaciera imię w historii. */
  deleteAccount(): Promise<void>;
  createGroup(a: { groupId: string; name: string; ownerMemberId: string; displayName: string }): Promise<void>;
  createInvite(groupId: string, role: 'member' | 'admin'): Promise<Invite>;
  acceptInvite(token: string, displayName: string): Promise<{ groupId: string }>;
  revokeInvite(inviteId: string): Promise<void>;
}
