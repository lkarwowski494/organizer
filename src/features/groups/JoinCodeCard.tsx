/**
 * Karta gotowego kodu do ID grupy (D92–D94): ID, kod, ważność, „Wyślij”, „Nowy kod” (PW-41 A) i „Unieważnij kod”.
 * Jedna dla zaproszenia (ekran grupy) i połączenia profilu dziecka z kontem (ekran osoby, PW-14 B) — ten sam wygląd
 * i te same czynności. Koniec ważności w czasie Europe/Warsaw: na ekranie „jutro, 18:40”, w wiadomości „piątek,
 * 9 października, 18:40” (audyt 2, U-41: adresat czyta ją później, „jutro” znaczy wtedy co innego).
 */
import { useState } from 'react';
import { Share, Text, View } from 'react-native';

import { localNow } from '../../domain/local-time';
import { type CivilDate, formatIsoDate } from '../../domain/civil-date';
import { formatDue } from '../../domain/format';
import { groupDigits } from '../../domain/invite-link';
import { strings } from '../../i18n/strings.pl';
import type { JoinInvite } from '../../sync/account';
import { Body, Button, Card, CardTitle } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { absoluteDay } from './dates';

const hhmm = (l: ReturnType<typeof localNow>) => `${String(l.hh).padStart(2, '0')}:${String(l.mm).padStart(2, '0')}`;
const until = (iso: string, today: CivilDate) => {
  const l = localNow(Date.parse(iso));
  return formatDue({ date: formatIsoDate(l), time: hhmm(l) }, today);
};
const untilAbs = (iso: string, today: CivilDate) => `${absoluteDay(Date.parse(iso), today)}, ${hhmm(localNow(Date.parse(iso)))}`;

export function JoinCodeCard(p: {
  code: JoinInvite;
  today: CivilDate;
  title: string;
  /** Dla kogo kod („Dołączy jako: członek”, „Dla: Tymek”). */
  note: string;
  /** Opis pod kodem; dostaje ważność do pokazania na ekranie. */
  info: (until: string) => string;
  /** Treść wiadomości; dostaje ID i kod do podyktowania oraz ważność bezwzględną. */
  message: (id: string, code: string, until: string) => string;
  onRenew: () => void;
  onRevoke: () => void;
  testIDs: { card: string; code: string; renew: string };
}) {
  const { c, font, size } = useTheme();
  const [confirm, setConfirm] = useState(false);
  const id = groupDigits(p.code.joinId);
  const code = groupDigits(p.code.code);
  return (
    <Card testID={p.testIDs.card}>
      <CardTitle>{p.title}</CardTitle>
      <Body muted>{p.note}</Body>
      <Body>{`${strings['groups.joinId']}: ${id}`}</Body>
      <Text testID={p.testIDs.code} style={{ fontFamily: font.display800, fontSize: size.CODE, letterSpacing: 2, color: c.ink }}>{`${strings['groups.joinCode']}: ${code}`}</Text>
      <Body muted>{p.info(until(p.code.expiresAt, p.today))}</Body>
      <Button label={strings['groups.share']} onPress={() => void Share.share({ message: p.message(id, code, untilAbs(p.code.expiresAt, p.today)) })} />
      <Button kind="secondary" label={strings['groups.newCode']} a11yHint={strings['groups.newCodeInfo']} testID={p.testIDs.renew} onPress={p.onRenew} />
      {/* Audyt 2 (G-37, R-19): kod znika dopiero po unieważnieniu; przy błędzie zostaje do ponowienia (robi to ekran).
          D187: unieważnienia nie da się cofnąć (serwer nie przywraca kodu, „Nowy kod” daje inny), więc jedno pytanie. */}
      {confirm ? (
        <View style={{ gap: 8 }}>
          <Body>{strings['groups.revokeConfirm']}</Body>
          <Button kind="danger" label={strings['groups.revoke']} testID="revoke-confirm" onPress={p.onRevoke} />
          <Button kind="secondary" label={strings['common.cancel']} onPress={() => setConfirm(false)} />
        </View>
      ) : (
        <Button kind="danger" label={strings['groups.revoke']} testID="revoke" onPress={() => setConfirm(true)} />
      )}
    </Card>
  );
}
