/**
 * Połączenie z serwerem widziane przez pętlę synchronizacji. W aplikacji: RPC Supabase
 * (src/sync/supabase.ts), w testach: serwer w pamięci. Błąd zawsze jako TransportError z rodzajem,
 * bo od rodzaju zależy reakcja pętli (scheduler: sieć/serwer → ponowienie, auth → czekanie na sesję).
 */
import type { PulledRow, PullResponse, PushResponse, pushRequest } from '../domain/sync-engine/client';

export type PushRequest = ReturnType<typeof pushRequest>;

export interface SyncTransport {
  push(req: PushRequest): Promise<PushResponse>;
  pull(cursors: { [groupId: string]: number }, limit: number): Promise<PullResponse>;
  fetchScope(listId: string): Promise<PulledRow[]>;
}

export type TransportErrorKind = 'network' | 'auth' | 'server';

export class TransportError extends Error {
  constructor(
    readonly kind: TransportErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/** Nieznany wyjątek (np. błąd fetch bez sieci) traktujemy jak brak sieci — scheduler ponowi z opóźnieniem. */
export function errorKind(e: unknown): TransportErrorKind {
  return e instanceof TransportError ? e.kind : 'network';
}
