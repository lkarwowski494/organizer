/**
 * Grupy, osoby i zaproszenia po audycie 2 (paczka grup): pola podążają za danymi i zapisują tylko moją zmianę (D130),
 * ekran świeżo utworzonej grupy, ponowienie tworzenia, unieważnienie kodu, przekazanie własności, kosz, komunikaty
 * błędów serwera, pierwszeństwo ID i kodu, link TestFlight w wiadomości, nowa lista bez grup dziecka.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, Share, TextInput } from 'react-native';

import { config } from '../../config';
import type { Row } from '../../domain/sync-engine/client';
import type { Occurrence } from '../../domain/views/events';
import { OccurrencePicker } from '../../features/events/OccurrencePicker';
import { TransportError } from '../../sync/transport';
import { RootStack } from '../navigation';
import { answerAlert, expectOps, fakeAccount, lastAlert, ME, put, sampleBase, setup } from './harness';

const press = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(el);
const type = (el: Parameters<typeof fireEvent.changeText>[0], text: string) => fireEvent.changeText(el, text);
const blur = (el: Parameters<typeof fireEvent.press>[0]) => fireEvent(el, 'blur');
type Base = ReturnType<typeof sampleBase>;

async function open(opts: Parameters<typeof setup>[0] = {}) {
  const s = setup(opts);
  await s.renderApp(<RootStack />);
  await screen.findByTestId('screen-today');
  return s;
}
/** Zmiana z serwera (drugi telefon): podmiana pól wiersza w danych bazowych. */
const remote = (s: Awaited<ReturnType<typeof open>>, e: string, id: string, set: Row) =>
  act(async () => s.store.pull((b) => ({ ...b, [e]: { ...b[e], [id]: { ...b[e]![id]!, ...set } } })));
const asOwner = (): Base => {
  const base = sampleBase();
  base.group_members!.mf = { ...base.group_members!.mf, role: 'owner' };
  base.group_members!.ala = { ...base.group_members!.ala, role: 'admin' };
  return base;
};
async function openGroup(s: Awaited<ReturnType<typeof open>>, id = 'gf') {
  await press(screen.getByLabelText('Grupy'));
  // Zakładki kończą przejście zegarem (32 ms, BottomTabView) — niech minie w act, nie po teście.
  await act(() => new Promise((r) => setTimeout(r, 50)));
  await press(await screen.findByTestId(`group-${id}`));
  await screen.findByTestId('screen-group');
  return s;
}

describe('ja w grupie (audyt 2, P17: U-30, P-67)', () => {
  it('na liście osób przy mnie „(Ty)”, a na moim ekranie odnośnik do imienia we wszystkich grupach', async () => {
    const s = await open({ base: asOwner() });
    await openGroup(s);
    await press(screen.getByTestId('member-mf'));
    expect(await screen.findByTestId('screen-member')).toBeTruthy();
    expect(screen.getByText(/Imię we wszystkich grupach zmienisz w Ustawieniach → Konto i dane → Twoje imię/)).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    expect(within(screen.getByTestId('member-mf')).getByText('Łukasz (Ty)')).toBeTruthy();
    await press(screen.getByTestId('member-ala'));
    expect(screen.queryByText(/Imię we wszystkich grupach/)).toBeNull();
  });
});

describe('nazwa grupy i imię osoby a zmiany z drugiego telefonu (audyt 2, R-36, T-22)', () => {
  it('nazwa grupy: bez edycji pole pokazuje nową nazwę, a wyjście z pola i z ekranu nic nie wysyła', async () => {
    const s = await openGroup(await open());
    await remote(s, 'groups', 'gf', { name: 'Rodzina Kowalskich' });
    expect(screen.getByTestId('group-rename').props.value).toBe('Rodzina Kowalskich');
    await blur(screen.getByTestId('group-rename'));
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-groups');
    expect(s.store.dispatched).toEqual([]);
  });

  it('nazwa grupy: moja zmiana wygrywa przy wyjściu z pola i nie idzie drugi raz przy wyjściu z ekranu', async () => {
    const s = await openGroup(await open());
    await type(screen.getByTestId('group-rename'), 'Rodzina K.');
    await remote(s, 'groups', 'gf', { name: 'Rodzina (Ala)' });
    expect(screen.getByTestId('group-rename').props.value).toBe('Rodzina K.');
    await blur(screen.getByTestId('group-rename'));
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'groups', id: 'gf', set: { name: 'Rodzina K.' } }]);
    expect(screen.getByText('Rodzina K.')).toBeTruthy(); // tytuł ekranu od razu (zmiana w kolejce)
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-groups');
    expect(s.store.dispatched).toHaveLength(1);
  });

  it('nazwa grupy: zapis przy wyjściu z ekranu bez wyjścia z pola; pustej nie zapisujemy — komunikat (PW-20 A)', async () => {
    const s = await openGroup(await open());
    await type(screen.getByTestId('group-rename'), '   ');
    await blur(screen.getByTestId('group-rename'));
    expect(screen.getByRole('alert').props.children).toBe('Wpisz nazwę grupy.');
    // Jedna reguła pól zapisywanych od razu (ui/live-text, jak tytuł zadania — M-202): pole wraca do zapisanej nazwy.
    expect(screen.getByTestId('group-rename').props.value).toBe('Rodzina');
    expect(s.store.dispatched).toEqual([]);
    await type(screen.getByTestId('group-rename'), ' Dom ');
    expect(screen.queryByRole('alert')).toBeNull();
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-groups');
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'groups', id: 'gf', set: { name: 'Dom' } }]);
  });

  it('wyjście z grupy: niezapisana nazwa przepada (serwer odrzuciłby zmianę)', async () => {
    const s = await openGroup(await open());
    await type(screen.getByTestId('group-rename'), 'Nowa nazwa');
    await press(screen.getByTestId('leave'));
    await answerAlert('Wyjdź z grupy');
    await screen.findByTestId('screen-groups');
    expect(s.store.dispatched).toEqual([{ kind: 'delete', entity: 'group_members', id: 'mf' }]);
  });

  it('kosz grupy: niezapisana nazwa przepada', async () => {
    const s = await openGroup(await open({ base: asOwner() }));
    await type(screen.getByTestId('group-rename'), 'Nowa nazwa');
    await press(screen.getByTestId('delete-group'));
    await answerAlert('Usuń grupę');
    await screen.findByTestId('screen-groups');
    expect(s.account.deleteGroup).toHaveBeenCalledWith('gf');
    expect(s.store.dispatched).toEqual([]);
  });

  it('imię osoby: bez edycji podąża za danymi i nic nie wysyła; moja zmiana zapisuje się przy wyjściu z ekranu', async () => {
    const s = await openGroup(await open());
    await press(screen.getByTestId('member-tymek'));
    await screen.findByTestId('screen-member');
    await remote(s, 'group_members', 'tymek', { display_name: 'Tymoteusz' });
    expect(screen.getByTestId('member-name').props.value).toBe('Tymoteusz');
    await blur(screen.getByTestId('member-name'));
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-group');
    expect(s.store.dispatched).toEqual([]);
    await press(screen.getByTestId('member-tymek'));
    await type(await screen.findByTestId('member-name'), 'Tymuś');
    await remote(s, 'group_members', 'tymek', { display_name: 'Tymoteusz B.' });
    expect(screen.getByTestId('member-name').props.value).toBe('Tymuś');
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-group');
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'group_members', id: 'tymek', set: { display_name: 'Tymuś' } }]);
  });

  it('imię osoby: wyjście z pola zapisuje raz; puste i za długie — komunikat bez zapisu (PW-20 A)', async () => {
    const s = await openGroup(await open());
    await press(screen.getByTestId('member-tymek'));
    await type(await screen.findByTestId('member-name'), 'Tymoteusz');
    await fireEvent(screen.getByTestId('member-name'), 'submitEditing');
    expect(s.store.dispatched).toEqual([{ kind: 'patch', entity: 'group_members', id: 'tymek', set: { display_name: 'Tymoteusz' } }]);
    await type(screen.getByTestId('member-name'), ' ');
    await blur(screen.getByTestId('member-name'));
    expect(screen.getByRole('alert').props.children).toBe('Wpisz imię.');
    await type(screen.getByTestId('member-name'), 'x'.repeat(101));
    expect(screen.queryByRole('alert')).toBeNull();
    await blur(screen.getByTestId('member-name'));
    expect(screen.getByRole('alert').props.children).toBe('Imię może mieć najwyżej 100 znaków.');
    await press(screen.getByLabelText('Wróć'));
    await screen.findByTestId('screen-group');
    expect(s.store.dispatched).toHaveLength(1);
  });

  it('usunięcie osoby bez pytania, z paskiem „Cofnij”; niezapisane imię przepada (PW-35 A, PW-16 A)', async () => {
    const s = await openGroup(await open());
    await press(screen.getByTestId('member-tymek'));
    await type(await screen.findByTestId('member-name'), 'Tymek B.');
    await press(screen.getByTestId('remove-member'));
    await screen.findByTestId('screen-group');
    expect(s.store.dispatched).toEqual([{ kind: 'delete', entity: 'group_members', id: 'tymek' }]);
    expect(screen.queryByTestId('member-tymek')).toBeNull();
    expect(within(screen.getByTestId('undo-bar')).getByText('Usunięto z grupy: Tymek')).toBeTruthy();
    await press(screen.getByLabelText('Cofnij'));
    expectOps(s.store, [{ kind: 'delete', entity: 'group_members', id: 'tymek' }, { kind: 'restore', entity: 'group_members', id: 'tymek' }]);
    expect(await screen.findByTestId('member-tymek')).toBeTruthy();
  });

  it('admin zmienia imię profilu dziecka, ale nie osoby z kontem (PW-54 A)', async () => {
    await openGroup(await open());
    await press(screen.getByTestId('member-ala'));
    await screen.findByTestId('screen-member');
    expect(screen.queryByTestId('member-name')).toBeNull();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByTestId('member-tymek'));
    expect(await screen.findByTestId('member-name')).toBeTruthy();
  });
});

describe('nowa grupa i dołączenie (audyt 2, R-16, R-27, R-38, R-39)', () => {
  const arrive = (s: Awaited<ReturnType<typeof open>>, groupId: string, memberId: string, name: string) =>
    act(async () =>
      s.store.pull((b) => ({
        ...b,
        groups: { ...b.groups, [groupId]: { id: groupId, name, kind: 'shared', created_at: '2026-10-07T08:00:00Z', deleted_at: null, version: 1 } },
        group_members: { ...b.group_members, [memberId]: { member_id: memberId, group_id: groupId, user_id: ME, display_name: 'Łukasz', role: 'owner', created_at: '2026-10-07T08:00:00Z', deleted_at: null, version: 1 } },
      })),
    );

  it('po utworzeniu: „Pobieramy grupę…” zamiast błędu, potem nazwa w polu; ponowienie z tymi samymi identyfikatorami', async () => {
    let fail = true;
    const account = fakeAccount({ createGroup: jest.fn(async () => (fail ? Promise.reject(new Error('Network request failed')) : undefined)) });
    const s = await open({ account });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Nowa grupa'));
    await type(screen.getByTestId('group-name'), 'Sąsiedzi');
    await press(screen.getByTestId('create-group'));
    expect(await screen.findByText('Coś poszło nie tak. Spróbuj jeszcze raz. Ta czynność wymaga internetu.')).toBeTruthy();
    fail = false;
    await press(screen.getByTestId('create-group'));
    const [first, second] = account.createGroup.mock.calls.map((c) => c[0]);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ groupId: 'new-1', ownerMemberId: 'new-2', name: 'Sąsiedzi', displayName: 'Łukasz' });
    expect(await screen.findByTestId('screen-group-loading')).toBeTruthy();
    expect(screen.getByText('Pobieramy grupę…')).toBeTruthy();
    await arrive(s, 'new-1', 'new-2', 'Sąsiedzi');
    expect(await screen.findByTestId('screen-group')).toBeTruthy();
    expect(screen.getByTestId('group-rename').props.value).toBe('Sąsiedzi');
  });

  it('po dołączeniu: „Pobieramy grupę…”, potem dane; grupa, której nie ma (np. w koszu), to błąd', async () => {
    const account = fakeAccount({ joinGroup: jest.fn(async () => ({ groupId: 'gnew' })) });
    const base = sampleBase();
    put(base, 'groups', 'gkosz', { id: 'gkosz', name: 'Kosz', kind: 'shared', created_at: '2026-01-01T00:00:00Z', deleted_at: '2026-10-06T08:00:00Z', version: 1 });
    const s = await open({ account, base });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Dołącz do grupy'));
    await type(await screen.findByTestId('invite-join-id'), '482913507');
    await type(screen.getByTestId('invite-code'), '731064');
    await press(screen.getByTestId('invite-accept'));
    expect(await screen.findByTestId('screen-group-loading')).toBeTruthy();
    // Audyt 3 (N-45, Q14 A): dołączona grupa zostaje ostatnio użytą (jak nowo utworzona).
    expect(s.services.local!.load('lastUsedGroup')).toBe('gnew');
    await arrive(s, 'gnew', 'm-new', 'Sąsiedzi');
    expect(await screen.findByTestId('screen-group')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    account.joinGroup.mockResolvedValueOnce({ groupId: 'gkosz' });
    await press(await screen.findByLabelText('Dołącz do grupy'));
    await type(await screen.findByTestId('invite-join-id'), '482913507');
    await type(screen.getByTestId('invite-code'), '731064');
    await press(screen.getByTestId('invite-accept'));
    expect(await screen.findByTestId('screen-group-missing')).toBeTruthy();
  });

  it('błędy serwera po kodzie: unieważniony, wykorzystany, osoba usunięta z grupy, za długa nazwa, nieznany błąd serwera', async () => {
    const errors: Error[] = [new Error('invite_revoked'), new Error('invite_used_up'), new Error('invite_removed')];
    const account = fakeAccount({
      joinGroup: jest.fn(async () => Promise.reject(errors.shift())),
      createGroup: jest
        .fn()
        .mockRejectedValueOnce(new TransportError('server', 'new row for relation "groups" violates check constraint "groups_name_check"'))
        .mockRejectedValueOnce(new TransportError('server', 'coś nowego')) as jest.Mocked<typeof account>['createGroup'],
    });
    await open({ account });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Dołącz do grupy'));
    await type(await screen.findByTestId('invite-join-id'), '482913507');
    await type(screen.getByTestId('invite-code'), '731064');
    await press(screen.getByTestId('invite-accept'));
    expect(await screen.findByText('Ten kod został unieważniony (przez osobę zapraszającą albo po zbyt wielu błędnych próbach). Poproś o nowe zaproszenie.')).toBeTruthy();
    await press(screen.getByTestId('invite-accept'));
    expect(await screen.findByText(/Z tego kodu skorzystała już największa dozwolona liczba osób/)).toBeTruthy();
    await press(screen.getByTestId('invite-accept'));
    expect(await screen.findByText(/^Usunięto Cię z tej grupy\. Wrócić możesz tylko z nowym zaproszeniem/)).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(await screen.findByLabelText('Nowa grupa'));
    await type(screen.getByTestId('group-name'), 'x'.repeat(201));
    await press(screen.getByTestId('create-group'));
    expect(await screen.findByText('Nazwa grupy albo imię są za długie. Skróć je i spróbuj jeszcze raz.')).toBeTruthy();
    await press(screen.getByTestId('create-group'));
    expect(await screen.findByText('Coś poszło nie tak. Spróbuj jeszcze raz.')).toBeTruthy();
    expect(screen.queryByText(/wymaga internetu/)).toBeNull();
  });

  it('wpisane ID i kod mają pierwszeństwo przed starym kodem z wklejonej wiadomości', async () => {
    const tok = 'cd'.repeat(32);
    const account = fakeAccount();
    await open({ account });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Dołącz do grupy'));
    await type(await screen.findByTestId('invite-join-id'), '482 913 507');
    await type(screen.getByTestId('invite-code'), '731 064');
    await type(screen.getByTestId('invite-input'), `Stare zaproszenie:\n${tok}`);
    await press(screen.getByTestId('invite-accept'));
    expect(account.joinGroup).toHaveBeenCalledWith('482913507', '731064', 'Łukasz');
    expect(account.acceptInvite).not.toHaveBeenCalled();
  });
});

describe('zaproszenie (audyt 2, R-19, PW-7)', () => {
  it('nieudane unieważnienie zostawia kod z komunikatem; ponowienie go chowa', async () => {
    const account = fakeAccount({ revokeInvite: jest.fn().mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce(undefined) as jest.Mocked<ReturnType<typeof fakeAccount>>['revokeInvite'] });
    await openGroup(await open({ account }));
    await press(screen.getByTestId('invite'));
    await screen.findByTestId('invite-ready');
    await press(screen.getByTestId('revoke'));
    await answerAlert('Unieważnij kod');
    expect(await screen.findByText(/Ta czynność wymaga internetu/)).toBeTruthy();
    expect(screen.getByTestId('invite-ready')).toBeTruthy();
    await press(screen.getByTestId('revoke'));
    await answerAlert('Unieważnij kod');
    expect(account.revokeInvite).toHaveBeenCalledTimes(2);
    expect(account.revokeInvite).toHaveBeenLastCalledWith('inv-2');
    expect(screen.queryByTestId('invite-ready')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('wiadomość mówi, jak zainstalować aplikację, tylko gdy publiczny link TestFlight jest ustawiony', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await openGroup(await open());
    await press(screen.getByTestId('invite'));
    await press(await screen.findByLabelText('Wyślij zaproszenie'));
    const plain = (share.mock.calls.at(-1)![0] as { message: string }).message;
    expect(plain).not.toContain('TestFlight');
    expect(plain).toContain('W aplikacji: Grupy → „Dołącz do grupy”');
    const link = jest.replaceProperty(config.invites, 'TESTFLIGHT_LINK', 'https://testflight.apple.com/join/AbCd1234');
    await press(screen.getByLabelText('Wyślij zaproszenie'));
    const msg = (share.mock.calls.at(-1)![0] as { message: string }).message;
    expect(msg).toContain('\n\nNie masz jeszcze aplikacji? Zainstaluj ją przez TestFlight: https://testflight.apple.com/join/AbCd1234\n\nW aplikacji: Grupy → „Dołącz do grupy” i wpisz:');
    link.restore();
    share.mockRestore();
  });
});

describe('przekazanie własności (audyt 2, R-33)', () => {
  it('po przekazaniu ekran czeka na pobranie; ekran grupy nie pokazuje już opcji właściciela', async () => {
    const s = await openGroup(await open({ base: asOwner() }));
    expect(screen.getByTestId('rotate-join-id')).toBeTruthy();
    await press(screen.getByTestId('member-ala'));
    await press(await screen.findByTestId('make-owner'));
    await press(screen.getByTestId('make-owner-confirm'));
    expect(await screen.findByText('Przekazano. Pobieramy zmiany…')).toBeTruthy();
    expect(s.account.transferOwnership).toHaveBeenCalledWith('gf', 'ala');
    expect(s.store.refresh).toHaveBeenCalled();
    expect(screen.getByTestId('screen-member')).toBeTruthy();
    expect(screen.queryByTestId('make-owner-confirm')).toBeNull();
    expect(screen.queryByTestId('remove-member')).toBeNull();
    expect(screen.queryByLabelText('Członek')).toBeNull();
    await act(async () =>
      s.store.pull((b) => ({ ...b, group_members: { ...b.group_members, mf: { ...b.group_members!.mf!, role: 'admin' }, ala: { ...b.group_members!.ala!, role: 'owner' } } })),
    );
    expect(await screen.findByTestId('screen-group')).toBeTruthy();
    expect(screen.queryByTestId('rotate-join-id')).toBeNull();
    expect(screen.queryByTestId('delete-group')).toBeNull();
    expect(screen.getByLabelText('Ala, właściciel')).toBeTruthy();
  });

  it('osoby nie ma już w grupie: komunikat zamiast „wymaga internetu”', async () => {
    const account = fakeAccount({ transferOwnership: jest.fn(async () => Promise.reject(new TransportError('server', 'invalid_member'))) });
    await openGroup(await open({ base: asOwner(), account }));
    await press(screen.getByTestId('member-ala'));
    await press(await screen.findByTestId('make-owner'));
    await press(screen.getByTestId('make-owner-confirm'));
    expect(await screen.findByText('Tej osoby nie ma już w grupie.')).toBeTruthy();
  });
});

describe('kosz grup (audyt 2, G-38, A-49, R-18)', () => {
  const trashed = () => {
    const base = asOwner();
    base.groups!.gf = { ...base.groups!.gf, deleted_at: '2026-10-06T08:00:00Z' };
    return base;
  };

  it('przycisk „Przywróć” w wierszu (bez „›”); pasek „Przywrócono” z „Cofnij” z powrotem do kosza', async () => {
    const s = await open({ base: trashed() });
    await press(screen.getByLabelText('Grupy'));
    const row = await screen.findByTestId('trash-gf');
    expect(within(row).getByText('Rodzina')).toBeTruthy();
    expect(within(row).getByText('usunięcie za 29 dni')).toBeTruthy();
    expect(within(row).queryByTestId('glyph-next', { includeHiddenElements: true })).toBeNull();
    await press(within(row).getByLabelText('Przywróć: Rodzina'));
    expect(s.account.restoreGroup).toHaveBeenCalledWith('gf');
    expect(s.store.refresh).toHaveBeenCalled();
    expect(within(await screen.findByTestId('undo-bar')).getByText('Przywrócono: Rodzina')).toBeTruthy();
    expect(screen.queryByTestId('trash-gf')).toBeNull();
    await press(screen.getByLabelText('Cofnij'));
    expect(s.account.deleteGroup).toHaveBeenCalledWith('gf');
    expect(await screen.findByTestId('trash-gf')).toBeTruthy();
  });

  it('błąd przywrócenia: komunikat (brak sieci, po terminie); wiersz zostaje', async () => {
    const account = fakeAccount({
      restoreGroup: jest.fn().mockRejectedValueOnce(new Error('Network request failed')).mockRejectedValueOnce(new TransportError('server', 'deleted:expired')) as jest.Mocked<ReturnType<typeof fakeAccount>>['restoreGroup'],
    });
    await open({ base: trashed(), account });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Przywróć: Rodzina'));
    expect(await screen.findByText('Coś poszło nie tak. Spróbuj jeszcze raz. Ta czynność wymaga internetu.')).toBeTruthy();
    expect(screen.getByTestId('trash-gf')).toBeTruthy();
    await press(screen.getByLabelText('Przywróć: Rodzina'));
    expect(await screen.findByText('Grupa była w koszu dłużej niż 30 dni — nie da się jej już przywrócić.')).toBeTruthy();
  });

  it('grupa wrzucona do kosza ponownie znów jest w koszu (po pobraniu z nową datą)', async () => {
    const s = await open({ base: trashed() });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Przywróć: Rodzina'));
    await remote(s, 'groups', 'gf', { deleted_at: null });
    expect(await screen.findByTestId('group-gf')).toBeTruthy();
    await remote(s, 'groups', 'gf', { deleted_at: '2026-10-07T07:00:00Z' });
    expect(await screen.findByTestId('trash-gf')).toBeTruthy();
    expect(screen.getByText('usunięcie za 30 dni')).toBeTruthy();
  });
});

describe('wybór terminu i nowa lista (audyt 2, G-14, P-71)', () => {
  it('wiersz wyboru terminu wybiera od razu, więc nie ma strzałki „›”', async () => {
    const s = setup();
    const onPick = jest.fn();
    const item = { eventId: 'ev', occurrenceDate: '2026-10-09', date: '2026-10-09', title: 'Tańce', startTime: '17:00', endTime: '18:00', line: 1 } as Occurrence;
    await render(s.wrap(<OccurrencePicker items={[item]} today={{ y: 2026, m: 10, d: 7 }} onPick={onPick} onCancel={() => {}} />));
    const row = screen.getByTestId('pick-ev-2026-10-09');
    expect(within(row).queryByTestId('glyph-next', { includeHiddenElements: true })).toBeNull();
    await press(row);
    expect(onPick).toHaveBeenCalledWith(item);
  });

  it('nowa lista: bez grup, w których jestem dzieckiem (serwer odrzuciłby listę)', async () => {
    const base = sampleBase();
    base.group_members!.mf = { ...base.group_members!.mf, role: 'child' };
    await open({ base });
    await press(screen.getByLabelText('Listy'));
    await press(await screen.findByLabelText('Nowa lista'));
    const groups = screen.getByLabelText('Grupa');
    expect(within(groups).queryByLabelText('Rodzina')).toBeNull();
    expect(within(groups).getByLabelText('Klasa 2b')).toBeTruthy();
    expect(within(groups).getByLabelText('Osobiste')).toBeTruthy();
  });
});

function memoryPrefs(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: jest.fn(async (k: string) => m.get(k) ?? null), set: jest.fn(async (k: string, v: string) => void m.set(k, v)) };
}

describe('decyzje właściciela z 8.10.2026 (paczka grup)', () => {
  it('PW-41 A: „Zaproś” pokazuje bieżący kod roli, „Nowy kod” tworzy kolejny tej samej roli', async () => {
    const s = await openGroup(await open({ base: asOwner() }));
    await press(screen.getByTestId('invite'));
    expect(await screen.findByText('Dołączy jako: członek')).toBeTruthy();
    expect(s.account.createJoinCode).toHaveBeenLastCalledWith('gf', 'member');
    await press(screen.getByLabelText('Nowy kod'));
    expect(s.account.renewJoinCode).toHaveBeenCalledWith('gf', 'member');
    expect((await screen.findByTestId('join-code')).props.children).toBe('Kod: 408 215');
    await press(screen.getByTestId('invite-admin'));
    expect(await screen.findByText('Dołączy jako: administrator')).toBeTruthy();
    await press(screen.getByLabelText('Nowy kod'));
    expect(s.account.renewJoinCode).toHaveBeenLastCalledWith('gf', 'admin');
  });

  it('PW-34 A: zdanie o rolach; w grupie z dziećmi pierwszy (główny) przycisk to „Zaproś jako administratora”', async () => {
    await openGroup(await open({ base: asOwner() }));
    expect(screen.getByText('Administrator zaprasza, dodaje dzieci i zarządza osobami. Członek korzysta z list, zadań i wydarzeń.')).toBeTruthy();
    const order = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel).filter((l) => l === 'Zaproś' || l === 'Zaproś jako administratora');
    expect(order).toEqual(['Zaproś jako administratora', 'Zaproś']);
    // Bez dzieci — „Zaproś” (członek) jak dotąd.
    const base = asOwner();
    delete base.group_members!.tymek;
    await openGroup(await open({ base }));
    const plain = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel).filter((l) => l === 'Zaproś' || l === 'Zaproś jako administratora');
    expect(plain).toEqual(['Zaproś', 'Zaproś jako administratora']);
  });

  it('PW-43 A: potwierdzenie wyjścia mówi o listach „Tylko ja” w koszu (PWD-4 A: okno systemowe tak/nie)', async () => {
    await openGroup(await open());
    await press(screen.getByTestId('leave'));
    expect(lastAlert()).toMatchObject({ title: 'Wyjdź z grupy', message: 'Na pewno wyjść? Stracisz dostęp do list tej grupy. Twoje listy „Tylko ja” trafią do kosza na 30 dni i wrócą, jeśli w tym czasie dołączysz ponownie. Twoje zadania zostaną w grupie bez osoby, a plan lekcji, obecności i historia dzieci — w grupie (plan skopiujesz przed wyjściem: Plan lekcji → „Skopiuj plan lekcji do…”).' });
    expect(lastAlert().buttons.map((b) => [b.text, b.style])).toEqual([['Anuluj', 'cancel'], ['Wyjdź z grupy', 'destructive']]);
  });

  it('PWD-21 A: członek widzi grupę w koszu z datą, do której właściciel może ją przywrócić', async () => {
    const base = sampleBase();
    base.groups!.gf = { ...base.groups!.gf, deleted_at: '2026-10-06T08:00:00Z' };
    await open({ base });
    await press(screen.getByLabelText('Grupy'));
    const row = await screen.findByTestId('trash-gf');
    expect(within(row).getByText('Grupa Rodzina w koszu (właściciel może przywrócić do: czwartek, 5 listopada)')).toBeTruthy();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('group-gf')).toBeNull();
  });

  it('PW-36 A: grupa z Pierwszych kroków — „Zakupy”, „Zadania” i karta „Następne kroki” do „Nie teraz”', async () => {
    const prefs = memoryPrefs();
    // Nowe konto (bez grupy wspólnej) — z grupą wspólną wyboru startu nie ma (PWD-20 A).
    const base = sampleBase();
    delete base.groups!.gf;
    delete base.groups!.gk;
    const s = setup({ prefs, base });
    await s.renderApp(<RootStack />);
    await press(await screen.findByTestId('welcome-skip'));
    await press(screen.getByTestId('welcome-family'));
    await press(await screen.findByTestId('create-group'));
    expect(s.account.createGroup).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'new-1', ownerMemberId: 'new-2', name: 'Rodzina' }));
    expect(s.store.dispatched).toEqual([
      { kind: 'create', entity: 'lists', id: 'new-3', group_id: 'new-1', set: { kind: 'shopping', name: 'Zakupy', visibility: 'group' } },
      { kind: 'create', entity: 'lists', id: 'new-4', group_id: 'new-1', set: { kind: 'tasks', name: 'Zadania', visibility: 'group' } },
    ]);
    expect(prefs.set).toHaveBeenCalledWith('nextSteps.new-1', '1');
    // Audyt 3 (N-45, Q14 A): nowa grupa zostaje ostatnio użytą — pierwsze wpisy z Moich spraw trafią do niej.
    expect(s.services.local!.load('lastUsedGroup')).toBe('new-1');
    await act(async () =>
      s.store.pull((b) => ({
        ...b,
        groups: { ...b.groups, 'new-1': { id: 'new-1', name: 'Rodzina 2', kind: 'shared', created_at: '2026-10-07T08:00:00Z', deleted_at: null, version: 1 } },
        group_members: { ...b.group_members, 'new-2': { member_id: 'new-2', group_id: 'new-1', user_id: ME, display_name: 'Łukasz', role: 'owner', created_at: '2026-10-07T08:00:00Z', deleted_at: null, version: 1 } },
      })),
    );
    const card = await screen.findByTestId('next-steps');
    expect(within(card).getByText('Następne kroki')).toBeTruthy();
    expect(screen.getByLabelText('Zakupy, lista pusta')).toBeTruthy();
    expect(screen.getByLabelText('Zadania, 0 otwartych')).toBeTruthy();
    // „Dodaj dziecko” przenosi do pola z imieniem dziecka (atrapa TextInput z jest-preset: focus to jest.fn).
    const focus = (TextInput as unknown as { prototype: { focus: jest.Mock } }).prototype.focus;
    focus.mockClear();
    await press(within(card).getByLabelText('Dodaj dziecko'));
    expect(focus).toHaveBeenCalledTimes(1);
    // Audyt 3 (N-8, Q10 C): rola wybrana na karcie — partner jako administrator, choć dzieci jeszcze nie ma.
    expect(within(card).getAllByRole('button').map((b) => b.props.accessibilityLabel).slice(0, 2)).toEqual(['Zaproś partnera (administrator)', 'Zaproś kogoś innego (członek)']);
    await press(within(card).getByLabelText('Zaproś partnera (administrator)'));
    expect(s.account.createJoinCode).toHaveBeenLastCalledWith('new-1', 'admin');
    expect(await screen.findByText('Dołączy jako: administrator')).toBeTruthy();
    await press(within(card).getByLabelText('Zaproś kogoś innego (członek)'));
    expect(s.account.createJoinCode).toHaveBeenLastCalledWith('new-1', 'member');
    expect(await screen.findByText('Dołączy jako: członek')).toBeTruthy();
    await press(within(card).getByLabelText('Zaplanuj zakupy'));
    expect(await screen.findByTestId('screen-list')).toBeTruthy();
    await press(screen.getByLabelText('Wróć'));
    await press(within(await screen.findByTestId('next-steps')).getByLabelText('Nie teraz'));
    expect(screen.queryByTestId('next-steps')).toBeNull();
    expect(prefs.set).toHaveBeenLastCalledWith('nextSteps.new-1', '0');
  });

  it('N-8 (Q10 C): administrator (nie właściciel) widzi na karcie jeden przycisk — zaproszenie członka', async () => {
    const s = await openGroup(await open({ prefs: memoryPrefs({ welcomeSeen: '1', 'nextSteps.gf': '1' }) }));
    const card = await screen.findByTestId('next-steps');
    expect(within(card).queryByLabelText('Zaproś partnera (administrator)')).toBeNull();
    await press(within(card).getByLabelText('Zaproś do grupy'));
    expect(s.account.createJoinCode).toHaveBeenLastCalledWith('gf', 'member');
  });

  it('N-156 (Q19 A): sam w grupie — usunięcie bez pytania, z „Cofnij”', async () => {
    const base = asOwner();
    delete base.group_members!.ala;
    delete base.group_members!.tymek;
    const s = await openGroup(await open({ base }));
    (Alert.alert as jest.Mock).mockClear();
    await press(screen.getByTestId('delete-group'));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(s.account.deleteGroup).toHaveBeenCalledWith('gf');
    expect(await screen.findByText('Usunięto grupę: Rodzina')).toBeTruthy();
  });

  it('PW-36 A: grupa z ekranu Grupy — bez list; karta „Następne kroki” jest (M-117, zasada A)', async () => {
    const prefs = memoryPrefs({ welcomeSeen: '1' });
    const s = await open({ prefs });
    await press(screen.getByLabelText('Grupy'));
    await press(await screen.findByLabelText('Nowa grupa'));
    await type(screen.getByTestId('group-name'), 'Sąsiedzi');
    await press(screen.getByTestId('create-group'));
    await screen.findByTestId('screen-group-loading');
    expect(s.store.dispatched).toEqual([]);
    expect(prefs.set).toHaveBeenCalledWith('nextSteps.new-1', '1');
  });
});

describe('audyt 3: grupy i role (PK-12)', () => {
  it('N-166: grupa osobista „tylko Ty” (bez „1 osoba · właściciel”); puste Listy wskazują przycisk listy zakupów', async () => {
    const base = sampleBase();
    base.lists = {};
    base.tasks = {};
    await open({ base });
    await press(screen.getByLabelText('Grupy'));
    expect(within(await screen.findByTestId(`group-${ME}`)).getByText('tylko Ty')).toBeTruthy();
    expect(within(screen.getByTestId('group-gf')).getByText('3 osoby · administrator')).toBeTruthy();
    await press(screen.getByLabelText('Listy'));
    expect(await screen.findByText('Nie masz jeszcze list. Zacznij od listy zakupów — „Nowa lista zakupów” niżej.')).toBeTruthy();
    expect(screen.getByLabelText('Nowa lista zakupów')).toBeTruthy();
  });
});

describe('audyt 3: osoba usunięta z grupy (N-162, Q33 A)', () => {
  const drop = (b: Record<string, Record<string, Row> | undefined>, g: string) =>
    Object.fromEntries(Object.entries(b).map(([e, rows]) => [e, Object.fromEntries(Object.entries(rows ?? {}).filter(([id, r]) => (e === 'groups' ? id !== g : r.group_id !== g)))]));

  it('ktoś mnie usunął: po pobraniu jednorazowy pasek z nazwą grupy; moje wyjście — bez paska', async () => {
    const s = await open();
    await act(async () => s.store.pull((b) => drop(b, 'gk')));
    expect(within(await screen.findByTestId('undo-bar')).getByText('Nie należysz już do grupy Klasa 2b')).toBeTruthy();
    // Moje wyjście z „Rodziny”: grupa znika już przed pobraniem, więc pasek nie mówi o niej.
    await openGroup(s);
    await press(screen.getByTestId('leave'));
    await answerAlert('Wyjdź z grupy');
    await screen.findByTestId('screen-groups');
    await act(async () => s.store.pull((b) => drop(b, 'gf')));
    expect(screen.queryByText('Nie należysz już do grupy Rodzina')).toBeNull();
  });
});
