#!/usr/bin/env node
/**
 * Nocny strażnik darmowych limitów (decyzja D185, audyt 2 M-78): mierzy zużycie projektu Supabase Free i pamięci
 * podręcznej Actions, porównuje z progami ostrzeżeń z `config.limits` (src/config/index.ts — jedno źródło prawdy, opis
 * w docs/limits.md) i podtrzymuje projekt zapytaniem do bazy, żeby nie został uśpiony.
 *
 * Źródła (przeczytane 8.10.2026):
 * - Supabase Management API, specyfikacja OpenAPI https://api.supabase.com/api/v1-json:
 *   `POST /v1/projects/{ref}/database/query/read-only` — „Run a sql query as supabase_read_only_user”;
 *   `GET /v1/projects/{ref}/analytics/endpoints/logs` — „Executes an SQL or LQL query on the project's unified logs
 *   stream … The timestamp range must be no more than 24 hours … SQL must be written in ClickHouse SQL dialect”;
 *   źródła logów filtrowane po `source_name` (https://supabase.com/changelog/48235-migration-of-supabase-management-api-logs-all-analytics-endpoint-to-logs-endpoint:
 *   „Filter by source_name instead of selecting a source table”).
 * - Uśpienie: „Free projects are paused after 1 week of inactivity” (https://supabase.com/pricing). Co jest „aktywnością”,
 *   Supabase nie opisuje — zapytanie do bazy co noc to nasz wybór (bez ruchu z aplikacji projekt i tak dostaje zapytanie).
 * - Ruch wychodzący (egress): „You can view Egress usage on the organization's usage page”
 *   (https://supabase.com/docs/guides/platform/manage-your-usage/egress) — API go nie podaje, więc skrypt tylko
 *   przypomina o ręcznym sprawdzeniu (docs/limits.md).
 * - Pamięć podręczna Actions: `GET /repos/{owner}/{repo}/actions/cache/usage`
 *   (https://docs.github.com/en/rest/actions/cache#get-github-actions-cache-usage-for-a-repository).
 *
 * Zmienne: SUPABASE_MONITOR_TOKEN (osobisty token dostępu Supabase; brak → nic nie jest mierzone ani podtrzymywane:
 * ostrzeżenie i kod 0 do dnia `config.LIMITS_MONITOR_TOKEN_REQUIRED_FROM`, od tego dnia błąd i kod 1), GITHUB_TOKEN
 * i GITHUB_REPOSITORY (opcjonalnie — pamięć Actions), GITHUB_STEP_SUMMARY.
 * Kod wyjścia: 0 — wszystko poniżej progów (albo brak sekretu przed datą graniczną); 1 — próg przekroczony, pomiar się
 * nie udał albo brak sekretu po dacie granicznej (nocny przebieg robi się czerwony, GitHub wysyła właścicielowi
 * powiadomienie). Tokenu nigdy nie wypisuje.
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.supabase.com';
/** Okno logów: najwyżej 24 h (opis endpointu logs), miesiąc liczony jako 30 takich okien — szacunek. */
const DAYS_PER_MONTH = 30;

/** Identyfikator projektu z adresu `https://<ref>.supabase.co` (config.SUPABASE_URL). */
export function projectRef(url) {
  const m = /^https:\/\/([a-z]{20})\.supabase\.co\/?$/.exec(url);
  if (!m) throw new Error(`Nieoczekiwany adres projektu: ${url}`);
  return m[1];
}

/** Wiersze z odpowiedzi: zapytanie SQL zwraca tablicę wierszy, endpoint logów — `{ result: [...] }`. */
function rows(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.result)) return body.result;
  if (body && body.error) throw new Error(`błąd API: ${typeof body.error === 'string' ? body.error : body.error.message}`);
  throw new Error('nieoczekiwany kształt odpowiedzi');
}

function firstNumber(body, key) {
  const v = Number(rows(body)[0]?.[key]);
  if (!Number.isFinite(v)) throw new Error(`brak liczby „${key}” w odpowiedzi`);
  return v;
}

async function call(fetchFn, url, init) {
  const res = await fetchFn(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} dla ${new URL(url).pathname}`);
  return res.json();
}

/**
 * Pomiary. Każdy pomiar osobno: błąd jednego nie ukrywa pozostałych. Zapytanie o rozmiar bazy jest zarazem
 * podtrzymaniem projektu.
 */
export async function measure({ fetchFn, token, ref, now, github }) {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const out = [];
  const attempt = async (name, fn) => {
    try {
      out.push({ name, value: await fn() });
    } catch (e) {
      out.push({ name, error: e instanceof Error ? e.message : String(e) });
    }
  };
  await attempt('dbBytes', async () => {
    const body = await call(fetchFn, `${API}/v1/projects/${ref}/database/query/read-only`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ query: 'select pg_catalog.pg_database_size(pg_catalog.current_database())::bigint as bytes' }),
    });
    return firstNumber(body, 'bytes');
  });
  await attempt('functionInvocationsPerMonth', async () => {
    const end = new Date(now);
    const start = new Date(end.getTime() - 24 * 3600 * 1000);
    const q = new URLSearchParams({
      sql: "select count(*) as n from logs where source_name = 'function_edge_logs'",
      iso_timestamp_start: start.toISOString(),
      iso_timestamp_end: end.toISOString(),
    });
    const body = await call(fetchFn, `${API}/v1/projects/${ref}/analytics/endpoints/logs?${q}`, { headers: auth });
    return firstNumber(body, 'n') * DAYS_PER_MONTH;
  });
  if (github?.token && github.repository) {
    await attempt('actionsCacheBytes', async () => {
      const body = await call(fetchFn, `https://api.github.com/repos/${github.repository}/actions/cache/usage`, {
        headers: { Authorization: `Bearer ${github.token}`, Accept: 'application/vnd.github+json' },
      });
      const v = Number(body.active_caches_size_in_bytes);
      if (!Number.isFinite(v)) throw new Error('brak active_caches_size_in_bytes');
      return v;
    });
  }
  return out;
}

/** Próg ostrzeżenia dla pomiaru (config.limits) i opis do raportu. */
export function thresholds(limits) {
  return {
    dbBytes: { warn: limits.supabaseDbBytesWarn, label: 'Rozmiar bazy Supabase', unit: 'bytes' },
    functionInvocationsPerMonth: { warn: limits.edgeFunctionInvocationsPerMonthWarn, label: 'Wywołania Edge Functions (ostatnie 24 h × 30)', unit: 'count' },
    actionsCacheBytes: { warn: limits.actionsCacheBytesWarn, label: 'Pamięć podręczna Actions', unit: 'bytes' },
  };
}

const fmt = (v, unit) => (unit === 'bytes' ? `${(v / 1024 ** 2).toFixed(1)} MB` : String(Math.round(v)));

/** Ocena pomiarów: ok / warn (≥ próg) / error (pomiar nieudany). */
export function evaluate(measurements, limits) {
  const t = thresholds(limits);
  return measurements.map((m) => {
    const th = t[m.name];
    if (m.error !== undefined) return { ...m, label: th.label, status: 'error', text: `pomiar nieudany: ${m.error}` };
    const status = m.value >= th.warn ? 'warn' : 'ok';
    return { ...m, label: th.label, warn: th.warn, status, text: `${fmt(m.value, th.unit)} (próg ${fmt(th.warn, th.unit)}, ${Math.round((100 * m.value) / th.warn)}% progu)` };
  });
}

export function report(results) {
  const icon = { ok: 'ok', warn: 'PRÓG', error: 'BŁĄD' };
  const lines = results.map((r) => `| ${r.label} | ${icon[r.status]} | ${r.text} |`);
  return [
    '### Darmowe limity (D185)',
    '',
    '| Zasób | Wynik | Wartość |',
    '|---|---|---|',
    ...lines,
    '',
    'Ruch wychodzący (egress) i wiadomości Realtime API nie podaje — sprawdź ręcznie na stronie zużycia organizacji (docs/limits.md).',
    '',
  ].join('\n');
}

export async function main({ env = process.env, fetchFn = fetch, now = Date.now(), log = console.log, loadConfig } = {}) {
  const { config } = await (loadConfig ?? (() => import('../../src/config/index.ts')))();
  const token = env.SUPABASE_MONITOR_TOKEN;
  if (!token) {
    const from = config.LIMITS_MONITOR_TOKEN_REQUIRED_FROM;
    const late = now >= Date.parse(`${from}T00:00:00Z`);
    log(
      `::${late ? 'error' : 'warning'}::Brak sekretu SUPABASE_MONITOR_TOKEN — limity nie są mierzone, a projekt nie jest podtrzymywany przed uśpieniem. ` +
        `Dodaj sekret (docs/limits.md, D185)${late ? '' : `; od ${from} brak sekretu oblewa to zadanie`}.`,
    );
    return late ? 1 : 0;
  }
  const ref = projectRef(config.SUPABASE_URL);
  const measured = await measure({ fetchFn, token, ref, now, github: { token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY } });
  const results = evaluate(measured, config.limits);
  const md = report(results);
  log(md);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md);
  // Egress i Realtime API nie podaje — raz w miesiącu (1. dnia, UTC) widoczne przypomnienie o ręcznym odczycie.
  if (new Date(now).getUTCDate() === 1) log('::warning::Początek miesiąca: sprawdź ręcznie egress i wiadomości Realtime na stronie zużycia organizacji Supabase (docs/limits.md).');
  for (const r of results) {
    if (r.status === 'warn') log(`::error::${r.label}: ${r.text} — przekroczony próg ostrzeżenia (70% limitu Free)`);
    if (r.status === 'error') log(`::error::${r.label}: ${r.text}`);
  }
  return results.every((r) => r.status === 'ok') ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => (process.exitCode = code),
    (e) => {
      console.log(`::error::free-limits: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    },
  );
}
