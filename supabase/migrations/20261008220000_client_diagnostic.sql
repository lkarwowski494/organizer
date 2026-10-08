-- Samosprawdzenie telefonu (S3, S4; D83): raz na wersję aplikacji wynik trafia do client_errors jako rodzaj
-- „diagnostic” (wersja SQLite, strefa czasowa w Hermesie, wycofanie transakcji). Bez treści z list.
alter table public.client_errors drop constraint client_errors_kind_check;
alter table public.client_errors add constraint client_errors_kind_check check (kind in ('crash', 'error', 'diagnostic'));
