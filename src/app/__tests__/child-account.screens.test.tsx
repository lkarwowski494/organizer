/**
 * Dziecko z własnym kontem (decyzja właściciela z 8.10.2026, PW-14 B): połączenie profilu dziecka z kontem kodem
 * jednorazowym, rola dziecka (zmienia owner), a u dziecka — tylko jego sprawy, zakupy bez pola odhaczenia, lekcje jednym
 * wierszem bez imienia, bez „Wyjdź z grupy” (audyt 2: M-90, M-91; R-11, R-13, R-14, P-70, N-38).
 */
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Share } from 'react-native';

import { config } from '../../config';
import { RootStack } from '../navigation';
import { fakeAccount, put, sampleBase, setup, expectOps } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
type Base = ReturnType<typeof sampleBase>;

async function open(opts: Parameters<typeof setup>[0] = {}) {
  const s = setup(opts);
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
async function openGroup(id: string) {
  await press(screen.getByLabelText('Grupy'));
  await act(() => new Promise((r) => setTimeout(r, 50)));
  await press(await screen.findByTestId(`group-${id}`));
  await screen.findByTestId('screen-group');
}
async function openMember(group: string, member: string) {
  await openGroup(group);
  await press(screen.getByTestId(`member-${member}`));
  await screen.findByTestId('screen-member');
}
const asOwner = (): Base => {
  const base = sampleBase();
  base.group_members!.mf = { ...base.group_members!.mf, role: 'owner' };
  base.group_members!.ala = { ...base.group_members!.ala, role: 'admin' };
  return base;
};
/** Ja jestem dzieckiem z kontem w „Klasie 2b” (mk): moje zadanie, zadanie rodzica, zakupy z dniem i moje lekcje. */
function childBase(): Base {
  const b = sampleBase();
  put(b, 'group_members', 'mk', { ...b.group_members!.mk!, role: 'child' });
  put(b, 'tasks', 't-korki', { ...b.tasks!['t-korki']!, assignee_member_id: 'mk' });
  put(b, 'tasks', 't-skladka', { ...b.tasks!['t-korki']!, id: 't-skladka', title: 'Zapłacić składkę', assignee_member_id: null, due_time: null });
  put(b, 'lists', 'lks', { id: 'lks', group_id: 'gk', kind: 'shopping', name: 'Na wycieczkę', visibility: 'group', owner_member_id: null, sort_key: 'a1', due_date: '2026-10-07', deleted_at: null, version: 1 });
  put(b, 'tasks', 's-woda', { ...b.tasks!['s-chleb']!, id: 's-woda', group_id: 'gk', list_id: 'lks', title: 'Woda' });
  for (const [id, title, start] of [['mat', 'Matematyka', '08:00:00'], ['pol', 'Polski', '09:00:00']] as const) {
    put(b, 'events', id, { id, group_id: 'gk', title, start_date: '2026-10-07', start_time: start, end_time: null, rrule: 'FREQ=WEEKLY;BYDAY=WE', audience: 'members', kind: 'lesson', deleted_at: null, version: 1 });
    put(b, 'event_participants', `p-${id}`, { id: `p-${id}`, event_id: id, group_id: 'gk', member_id: 'mk', deleted_at: null, version: 1 });
  }
  return b;
}

describe('połączenie profilu dziecka z kontem (PW-14 B)', () => {
  it('admin: kod przy profilu dziecka, wiadomość, „Nowy kod” i „Unieważnij kod”', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const s = await open();
    await openMember('gf', 'kuba');
    expect(screen.getByText(/Kuba może mieć własną aplikację/)).toBeTruthy();
    await press(screen.getByLabelText('Połącz z kontem dziecka'));
    expect(s.account.createChildCode).toHaveBeenCalledWith('kuba');
    expect(await screen.findByTestId('child-code-ready')).toBeTruthy();
    expect(screen.getByText('Połączy konto z profilem: Kuba')).toBeTruthy();
    expect(screen.getByTestId('child-code').props.children).toBe('Kod: 615 290');
    expect(screen.getByText(/Działa raz\. Na telefonie dziecka: zaloguj się przez Apple/)).toBeTruthy();
    expect(screen.queryByLabelText('Połącz z kontem dziecka')).toBeNull();
    await press(screen.getByLabelText('Wyślij zaproszenie'));
    const msg = (share.mock.calls.at(-1)![0] as { message: string }).message;
    expect(msg).toContain('profilem „Kuba” w grupie „Rodzina”');
    expect(msg).toContain('Zaloguj się w aplikacji przez Apple. Potem: Grupy → „Dołącz do grupy” i wpisz:\nID grupy: 482 913 507\nKod: 615 290 (ważny do: czwartek, 8 października, 10:00, działa raz)');
    expect(msg).not.toContain('TestFlight');
    await press(screen.getByTestId('child-code-new'));
    expect(s.account.renewChildCode).toHaveBeenCalledWith('kuba');
    expect(await screen.findByText('Kod: 903 417')).toBeTruthy();
    // D187: unieważnienie nieodwracalne — jedno pytanie (jak przy zaproszeniu do grupy).
    await press(screen.getByTestId('revoke'));
    await press(screen.getByTestId('revoke-confirm'));
    expect(s.account.revokeInvite).toHaveBeenLastCalledWith('inv-5');
    expect(screen.queryByTestId('child-code-ready')).toBeNull();
    expect(screen.getByLabelText('Połącz z kontem dziecka')).toBeTruthy();
    share.mockRestore();
  });

  it('wiadomość z linkiem i TestFlight, gdy są ustawione', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const live = jest.replaceProperty(config.invites as { LINK_LIVE: boolean }, 'LINK_LIVE', true);
    const tf = jest.replaceProperty(config.invites, 'TESTFLIGHT_LINK', 'https://testflight.apple.com/join/AbCd1234');
    await open();
    await openMember('gf', 'kuba');
    await press(screen.getByLabelText('Połącz z kontem dziecka'));
    await press(await screen.findByLabelText('Wyślij zaproszenie'));
    const msg = (share.mock.calls.at(-1)![0] as { message: string }).message;
    expect(msg).toContain('Zainstaluj ją przez TestFlight: https://testflight.apple.com/join/AbCd1234');
    expect(msg).toContain('Potem dotknij linku: https://lkarwowski494.github.io/j/?g=482913507&c=615290\n\nAlbo: Grupy');
    tf.restore();
    live.restore();
    share.mockRestore();
  });

  it('błędy kodu i unieważnienia — komunikat, kod zostaje do ponowienia', async () => {
    const account = fakeAccount({
      createChildCode: jest.fn(async () => Promise.reject(new Error('invalid_member'))),
    });
    await open({ account });
    await openMember('gf', 'kuba');
    await press(screen.getByLabelText('Połącz z kontem dziecka'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('child-code-ready')).toBeNull();
    account.createChildCode.mockImplementation(fakeAccount().createChildCode);
    account.revokeInvite.mockImplementation(async () => Promise.reject(new Error('offline')));
    await press(screen.getByLabelText('Połącz z kontem dziecka'));
    await screen.findByTestId('child-code-ready');
    expect(screen.queryByRole('alert')).toBeNull();
    await press(screen.getByTestId('revoke'));
    await press(screen.getByTestId('revoke-confirm'));
    expect(await screen.findByText(/Ta czynność wymaga internetu/)).toBeTruthy();
    expect(screen.getByTestId('child-code-ready')).toBeTruthy();
  });

  it('członek nie łączy profilu', async () => {
    const b = sampleBase();
    put(b, 'group_members', 'mf', { ...b.group_members!.mf!, role: 'member' });
    await open({ base: b });
    await openMember('gf', 'kuba');
    expect(screen.queryByLabelText('Połącz z kontem dziecka')).toBeNull();
    expect(screen.queryByText(/Dziecko widzi swoje sprawy/)).toBeNull();
  });
});

describe('rola dziecka z kontem: zmienia tylko owner (PW-14 B, R-13, R-14)', () => {
  it('owner: admin / członek / dziecko dla osoby z kontem; dziecko z kontem może dorosnąć', async () => {
    const b = asOwner();
    put(b, 'group_members', 'kuba', { ...b.group_members!.kuba!, user_id: 'u-kuba' });
    const s = await open({ base: b });
    await openMember('gf', 'kuba');
    expect(screen.getByText('Rodzina · dziecko · ma własne konto')).toBeTruthy();
    expect(screen.queryByLabelText('Połącz z kontem dziecka')).toBeNull();
    expect(screen.getByText(/Dziecko widzi swoje sprawy i wydarzenia/)).toBeTruthy();
    await press(screen.getByRole('radio', { name: 'członek' }));
    expectOps(s.store, [{ kind: 'patch', entity: 'group_members', id: 'kuba', set: { role: 'member' } }]);
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('member-ala'));
    await screen.findByTestId('screen-member');
    await press(screen.getByRole('radio', { name: 'dziecko' }));
    expectOps(s.store, [{ kind: 'patch', entity: 'group_members', id: 'ala', set: { role: 'child' } }]);
  });

  it('admin nie widzi wyboru roli (serwer: forbidden:role)', async () => {
    const b = sampleBase();
    put(b, 'group_members', 'kuba', { ...b.group_members!.kuba!, user_id: 'u-kuba' });
    await open({ base: b });
    await openMember('gf', 'kuba');
    expect(screen.queryByRole('radiogroup', { name: 'Rola' })).toBeNull();
    // Opis zasad dziecka z kontem widać i bez wyboru roli.
    expect(screen.getByText(/Dziecko widzi swoje sprawy i wydarzenia/)).toBeTruthy();
  });
});

describe('telefon dziecka z kontem', () => {
  it('Moje sprawy: tylko moje zadanie, zakupy bez pola odhaczenia, moje lekcje jednym wierszem bez imienia (P-70, R-11, N-38)', async () => {
    const s = await open({ base: childBase() });
    expect(screen.getByLabelText(/^Otwórz: Przynieść korki na trening/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Otwórz: Zapłacić składkę/)).toBeNull();
    // Zakupy widać (można otworzyć listę i odhaczać pozycje), ale bez pola „zrobione” — serwer go nie przyjmie.
    expect(within(screen.getByTestId('today-trip-lks')).queryByRole('checkbox')).toBeNull();
    expect(within(screen.getByTestId('today-t-korki')).getByRole('checkbox')).toBeTruthy();
    expect(screen.getByLabelText(/^2 lekcje, 08:00–09:00, Klasa 2b/)).toBeTruthy();
    expect(s.store.dispatched).toEqual([]);
  });

  it('Kalendarz: zakupy bez pola odhaczenia, bez zadania rodzica', async () => {
    await open({ base: childBase() });
    await press(screen.getByLabelText('Kalendarz'));
    await screen.findByTestId('screen-calendar');
    expect(within(screen.getByTestId('cal-trip-lks')).queryByRole('checkbox')).toBeNull();
    expect(screen.queryByLabelText(/Zapłacić składkę/)).toBeNull();
    expect(within(screen.getByTestId('cal-t-korki')).getByRole('checkbox')).toBeTruthy();
  });

  it('listy i zadanie: pole odhaczenia tylko przy moich sprawach (serwer: forbidden:not_own)', async () => {
    const b = childBase();
    put(b, 'tasks', 's-kanapki', { ...b.tasks!['s-woda']!, id: 's-kanapki', title: 'Kanapki', assignee_member_id: 'mk' });
    await open({ base: b });
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByTestId('list-lk'));
    expect(within(screen.getByTestId('task-t-korki')).getByRole('checkbox')).toBeTruthy();
    expect(within(screen.getByTestId('task-t-skladka')).queryByRole('checkbox')).toBeNull();
    await press(screen.getByLabelText(/^Otwórz: Zapłacić składkę/));
    await screen.findByTestId('screen-task');
    expect(screen.queryByLabelText(/^Oznacz jako zrobione/)).toBeNull();
    await press(screen.getByLabelText('Wróć'));
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('list-lks'));
    expect(within(screen.getByTestId('task-s-woda')).queryByRole('checkbox')).toBeNull();
    expect(within(screen.getByTestId('task-s-kanapki')).getByRole('checkbox')).toBeTruthy();
  });

  it('grupa: bez „Wyjdź z grupy” — wypisuje owner albo admin', async () => {
    await open({ base: childBase() });
    await openGroup('gk');
    expect(screen.queryByTestId('leave')).toBeNull();
    expect(screen.getByText('Z tej grupy wypisuje Cię właściciel albo admin.')).toBeTruthy();
  });
});
