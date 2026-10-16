/**
 * Arkusz monetyzacji impulsowej („Cheaper than Espresso” $0.99 / $4.99 / $14.99):
 * - Zgodny z Apple HIG: CancelButton po lewej stronie, bezpieczne strefy dotyku >= 48 pt.
 * - Jasna gwarancja ochrony historii: dotychczasowe dane nigdy nie są blokowane.
 */
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { strings } from '../../i18n/strings.pl';
import { buttonA11y } from '../../ui/a11y';
import { Button, CancelButton, Card } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useAppAccess } from './useAppAccess';

export function PaywallModal() {
  const { showPaywall, setShowPaywall, subscribe, restorePurchases } = useAppAccess();
  const [selected, setSelected] = useState<'yearly' | 'monthly' | 'lifetime'>('yearly');
  const [restoredMsg, setRestoredMsg] = useState(false);
  const { c, font, size, radius } = useTheme();

  if (!showPaywall) return null;

  const handleSubscribe = async () => {
    await subscribe(selected);
  };

  const handleRestore = async () => {
    const success = await restorePurchases();
    if (success) {
      setRestoredMsg(true);
      setTimeout(() => setShowPaywall(false), 1200);
    }
  };

  const plans = [
    {
      id: 'yearly' as const,
      name: strings['paywall.planYearly'],
      price: strings['paywall.planYearlyPrice'],
      desc: strings['paywall.planYearlyDesc'],
      badge: strings['paywall.trialBadge'],
    },
    {
      id: 'monthly' as const,
      name: strings['paywall.planMonthly'],
      price: strings['paywall.planMonthlyPrice'],
      desc: strings['paywall.planMonthlyDesc'],
      badge: null,
    },
    {
      id: 'lifetime' as const,
      name: strings['paywall.planLifetime'],
      price: strings['paywall.planLifetimePrice'],
      desc: strings['paywall.planLifetimeDesc'],
      badge: null,
    },
  ];

  const selectedPlan = plans.find((p) => p.id === selected) ?? plans[0]!;

  return (
    <Modal visible={showPaywall} animationType="slide" transparent presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
      <View testID="modal-paywall" style={{ flex: 1, backgroundColor: c.ground, padding: 18, justifyContent: 'space-between' }}>
        <View style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <CancelButton onPress={() => setShowPaywall(false)} testID="paywall-cancel" />
          </View>

          <View style={{ gap: 4 }}>
            <Text style={{ fontFamily: font.display700, fontSize: size.TITLE, color: c.ink }}>{strings['paywall.title']}</Text>
            <Text style={{ fontFamily: font.text400, fontSize: size.BODY, color: c.inkMuted, lineHeight: size.BODY * 1.3 }}>{strings['paywall.subtitle']}</Text>
          </View>

          <Card>
            <View style={{ gap: 4 }}>
              <Text style={{ fontFamily: font.text600, fontSize: size.BODY, color: c.ok }}>{strings['paywall.guaranteeTitle']}</Text>
              <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{strings['paywall.guaranteeDesc']}</Text>
            </View>
          </Card>

          <View style={{ gap: 10 }}>
            {plans.map((p) => {
              const isSelected = selected === p.id;
              return (
                <Pressable
                  key={p.id}
                  testID={`plan-${p.id}`}
                  {...buttonA11y({ selected: isSelected })}
                  accessibilityLabel={`${p.name}, ${p.price}`}
                  onPress={() => setSelected(p.id)}
                  style={{
                    padding: 14,
                    minHeight: 48,
                    borderRadius: radius.CARD,
                    borderWidth: 2,
                    borderColor: isSelected ? c.ink : c.border,
                    backgroundColor: isSelected ? c.surface : c.ground,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontFamily: font.text600, fontSize: size.BODY, color: c.ink }}>{p.name}</Text>
                      {p.badge ? (
                        <View style={{ backgroundColor: c.ok, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                          <Text style={{ fontFamily: font.text600, fontSize: size.META, color: c.surface }}>{p.badge}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={{ fontFamily: font.text400, fontSize: size.META, color: c.inkMuted }}>{p.desc}</Text>
                  </View>
                  <Text style={{ fontFamily: font.display700, fontSize: size.BODY, color: isSelected ? c.ink : c.inkMuted }}>{p.price}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 10, paddingBottom: 16 }}>
          {restoredMsg ? (
            <Text style={{ textAlign: 'center', fontFamily: font.text600, fontSize: size.META, color: c.ok }}>{strings['paywall.restored']}</Text>
          ) : null}
          <Button
            label={strings['paywall.subscribe'](selectedPlan.name)}
            testID="paywall-submit"
            onPress={() => void handleSubscribe()}
          />
          <Button
            kind="secondary"
            label={strings['paywall.restore']}
            testID="paywall-restore"
            onPress={() => void handleRestore()}
          />
        </View>
      </View>
    </Modal>
  );
}
