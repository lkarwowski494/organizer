/**
 * Nawigacja (D26): zakładki Moje sprawy / Listy / Kalendarz / Grupy (PW-27 A, D193) + ekrany nad nimi.
 * Linki głębokie (D40, schemat config.URL_SCHEME) skonfigurowane ręcznie: invite/<token>, join?g=&c= (i https …/j/?g=&c=,
 * D94), list/<id>, task/<id>, event/<id>[/<data>] — te same ścieżki niosą powiadomienia (PWD-16, NotificationOpener).
 */
import { type BottomTabBarProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, type LinkingOptions, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '../config';
import { CalendarScreen } from '../features/calendar/CalendarScreen';
import { EventEditScreen } from '../features/events/EventEditScreen';
import { EventScreen } from '../features/events/EventScreen';
import { GroupScreen } from '../features/groups/GroupScreen';
import { GroupsScreen } from '../features/groups/GroupsScreen';
import { InviteScreen } from '../features/groups/InviteScreen';
import { MemberScreen } from '../features/groups/MemberScreen';
import { NewGroupScreen } from '../features/groups/NewGroupScreen';
import { ListScreen } from '../features/lists/ListScreen';
import { ListsScreen } from '../features/lists/ListsScreen';
import { NewListScreen } from '../features/lists/NewListScreen';
import { TaskScreen } from '../features/lists/TaskScreen';
import { RejectedScreen } from '../features/settings/RejectedScreen';
import { RecentScreen } from '../features/groups/RecentScreen';
import { AddTaskScreen } from '../features/lists/AddTaskScreen';
import { FeedbackScreen } from '../features/settings/FeedbackScreen';
import { LicensesScreen } from '../features/settings/LicensesScreen';
import { NameScreen } from '../features/profile/NameScreen';
import { TimetableScreen } from '../features/groups/TimetableScreen';
import { RoutineScreen } from '../features/events/RoutineScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import { WelcomeScreen } from '../features/welcome/WelcomeScreen';
import { strings } from '../i18n/strings.pl';
import { useTheme } from '../ui/theme';
import { incomingHandoffs } from '../domain/views/handoffs';
import { useAppData, useServices } from './context';
import { appVersion, ErrorBoundary, reportsOn } from './diagnostics';
import { GroupLossNotice } from './GroupLossNotice';
import { HandoffNotifier } from './HandoffNotifier';
import { NotificationOpener } from './NotificationOpener';
import { UndoLinks } from './UndoLinks';
import { CalendarSyncProvider } from './calendar-sync';
import { DefaultGroupProvider } from './default-group';
import { MyScopeProvider } from './my-scope';
import { GroupFilterProvider } from './group-filter';
import { RemindersProvider } from './reminders';
import { TravelProvider } from './travel';
import { SeriesFiller } from './SeriesFiller';
import type { RootStackParams, TabParams } from './routes';

const Stack = createNativeStackNavigator<RootStackParams>();
const Tab = createBottomTabNavigator<TabParams>();

/**
 * Granica błędów jednego ekranu (audyt 3, N-1): błąd renderowania pokazuje „Coś poszło nie tak” tylko w tym ekranie —
 * zakładki i powrót (gest) działają dalej, a nie cała aplikacja przy każdym starcie. Zgłoszenie z nazwą ekranu (D80).
 */
function ScreenGuard({ name, children }: { name: string; children: ReactNode }) {
  const { account, local } = useServices();
  const { c } = useTheme();
  const report = useCallback((e: Parameters<typeof account.reportError>[0]) => void account.reportError(e).catch(() => {}), [account]);
  // Audyt 3 (N-74): account.reportError z Root wysyła tylko przy włączonych raportach; ekran awarii mówi tak samo.
  return (
    <ErrorBoundary report={report} reporting={() => reportsOn(local)} version={appVersion()} colors={c} screen={name}>
      {children}
    </ErrorBoundary>
  );
}
const screenLayout = ({ route, children }: { route: { name: string }; children: ReactNode }) => <ScreenGuard name={route.name}>{children}</ScreenGuard>;

const TAB_LABELS: Record<keyof TabParams, string> = {
  Today: strings['tabs.today'],
  Lists: strings['tabs.lists'],
  Calendar: strings['tabs.calendar'],
  Groups: strings['tabs.groups'],
};

/** Pasek zakładek z makiety „Wstążki”: zaokrąglony u góry, aktywna zakładka w pigułce (nie tylko kolor). */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { c, font, size, fontScale } = useTheme();
  const insets = useSafeAreaInsets();
  const { userId } = useServices();
  const { tables } = useAppData();
  // Plakietka na „Moje sprawy”: przekazania czekające na moją decyzję (D70).
  const pending = incomingHandoffs(tables, userId).length;
  return (
    // Audyt 2 (M-40): na iOS role „tab” i „tablist” nie dają żadnej cechy (React Native, accessibilityPropsConversions.h:
    // brak gałęzi; React Navigation też daje na iOS „button”, BottomTabItem.tsx). Pasek dostaje cechę paska kart
    // („tabbar” → UIAccessibilityTraitTabBar: VoiceOver mówi „karta 1 z 4”), zakładki — „button” na iOS.
    <View accessibilityRole="tabbar" style={{ flexDirection: 'row', paddingTop: 8, paddingHorizontal: 8, paddingBottom: Math.max(insets.bottom, 8), backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: c.border }}>
      {state.routes.map((r, i) => {
        const on = state.index === i;
        const label = TAB_LABELS[r.name as keyof TabParams];
        const badge = r.name === 'Today' && pending > 0 ? pending : 0;
        return (
          <Pressable
            key={r.key}
            accessibilityRole={Platform.OS === 'ios' ? 'button' : 'tab'}
            accessibilityState={{ selected: on }}
            accessibilityLabel={badge ? `${label}, ${strings['handoff.badge'](badge)}` : label}
            testID={`tab-${r.name}`}
            onPress={() => !on && navigation.navigate(r.name)}
            style={{ flex: 1, minHeight: size.TOUCH_TARGET + 8, alignItems: 'center', justifyContent: 'center', gap: 4 }}
          >
            {/* Aktywna zakładka jako pigułka w kolorze akcentu (D72) — wyróżniona kształtem, nie tylko kolorem. */}
            {/* M-43: napis rośnie z Dynamic Type do 200% i mieści się w jednej linii (zmniejsza się zamiast łamać w środku słowa). */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: on ? c.accentBg : 'transparent' }}>
              <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={fontScale.FIXED_MAX} style={{ flexShrink: 1, fontFamily: font.text700, fontSize: size.TAB, color: on ? c.accentInk : c.inkTab }}>{label}</Text>
              {badge ? (
                <View testID="tab-badge" style={{ minWidth: 18, minHeight: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: c.danger }}>
                  <Text maxFontSizeMultiplier={fontScale.FIXED_MAX} style={{ fontFamily: font.text700, fontSize: size.BADGE, color: c.inverseInk }}>{badge}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} screenLayout={screenLayout} tabBar={(p) => <TabBar {...p} />}>
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Lists" component={ListsScreen} />
      <Tab.Screen name="Calendar" component={CalendarScreen} />
      <Tab.Screen name="Groups" component={GroupsScreen} />
    </Tab.Navigator>
  );
}

export function RootStack() {
  return (
    <>
      <SeriesFiller />
      <HandoffNotifier />
      <NotificationOpener />
      <UndoLinks />
      <GroupLossNotice />
      <MyScopeProvider>
      <GroupFilterProvider>
      <TravelProvider>
      <RemindersProvider>
      <CalendarSyncProvider>
      <DefaultGroupProvider>
      <Stack.Navigator screenOptions={{ headerShown: false }} screenLayout={screenLayout}>
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen name="List" component={ListScreen} />
      <Stack.Screen name="Task" component={TaskScreen} />
      <Stack.Screen name="NewList" component={NewListScreen} />
      <Stack.Screen name="Group" component={GroupScreen} />
      <Stack.Screen name="Member" component={MemberScreen} />
      <Stack.Screen name="NewGroup" component={NewGroupScreen} />
      <Stack.Screen name="Event" component={EventScreen} />
      <Stack.Screen name="EventEdit" component={EventEditScreen} />
      <Stack.Screen name="Invite" component={InviteScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Rejected" component={RejectedScreen} />
      <Stack.Screen name="Recent" component={RecentScreen} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} />
      <Stack.Screen name="Licenses" component={LicensesScreen} />
      <Stack.Screen name="AddTask" component={AddTaskScreen} />
      {/* Audyt 2 (M-242): pytanie o imię przy starcie bez gestu cofania (zamknąłby je bez zapisu); z Ustawień — z gestem. */}
      <Stack.Screen name="Name" component={NameScreen} options={({ route }) => ({ gestureEnabled: route.params?.from === 'settings' })} />
      <Stack.Screen name="Timetable" component={TimetableScreen} />
      <Stack.Screen name="Routine" component={RoutineScreen} />
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      </Stack.Navigator>
      </DefaultGroupProvider>
      </CalendarSyncProvider>
      </RemindersProvider>
      </TravelProvider>
      </GroupFilterProvider>
      </MyScopeProvider>
    </>
  );
}

export const linking: LinkingOptions<RootStackParams> = {
  // D94: link https ze strony zaproszeń (Universal Links, ścieżka /j/?g=…&c=…) i ten sam w schemacie aplikacji (…://join?g=…&c=…).
  prefixes: [`${config.URL_SCHEME}://`, new URL(config.invites.JOIN_LINK).origin],
  config: {
    // Audyt 3 (N-37): ekran z linku ląduje na zakładkach, nie sam — inaczej przy starcie z linku „Wróć” nic nie robi,
    // a po dołączeniu do grupy nie ma drogi do „Moich spraw”. React Navigation, „Configuring links → Rendering an
    // initial route”: „use the `initialRouteName` property to specify the screen to use for the initial screen”
    // (https://reactnavigation.org/docs/configuring-links/).
    initialRouteName: 'Tabs',
    screens: {
      Tabs: { screens: { Today: 'today', Lists: 'lists', Calendar: 'calendar', Groups: 'groups' } },
      Invite: { path: 'invite/:token', alias: ['join', 'j'] },
      List: 'list/:listId',
      Task: 'task/:taskId',
      Event: 'event/:eventId/:date?',
    },
  },
};

/**
 * `pendingUrl` — link dotknięty, zanim nawigacja powstała (wylogowana aplikacja w tle, audyt 2 M-221): otwierany na
 * starcie zamiast linku, którym uruchomiono aplikację (domyślne getInitialURL React Navigation).
 */
export function AppNavigation({ pendingUrl = null }: { pendingUrl?: string | null }) {
  const { scheme, c } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const [start] = useState(pendingUrl);
  const options = useMemo(() => (start ? { ...linking, getInitialURL: () => start } : linking), [start]);
  return (
    <NavigationContainer linking={options} theme={{ ...base, colors: { ...base.colors, background: c.ground, card: c.surface, text: c.ink, border: c.border, primary: c.ink } }}>
      <RootStack />
    </NavigationContainer>
  );
}
