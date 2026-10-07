/**
 * Nawigacja (D26): zakładki Dziś / Listy / Kalendarz / Grupy + ekrany nad nimi.
 * Linki głębokie (D40, schemat config.URL_SCHEME) skonfigurowane ręcznie: invite/<token>, list/<id>, task/<id>.
 */
import { type BottomTabBarProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, type LinkingOptions, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Pressable, Text, View } from 'react-native';
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
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import { strings } from '../i18n/strings.pl';
import { useTheme } from '../ui/theme';
import type { RootStackParams, TabParams } from './routes';

const Stack = createNativeStackNavigator<RootStackParams>();
const Tab = createBottomTabNavigator<TabParams>();

const TAB_LABELS: Record<keyof TabParams, string> = {
  Today: strings['tabs.today'],
  Lists: strings['tabs.lists'],
  Calendar: strings['tabs.calendar'],
  Groups: strings['tabs.groups'],
};

/** Pasek zakładek z makiety: aktywna zakładka ma kreskę nad etykietą (nie tylko kolor). */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { c, font, size } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', paddingTop: 8, paddingHorizontal: 8, paddingBottom: Math.max(insets.bottom, 8), backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border }}>
      {state.routes.map((r, i) => {
        const on = state.index === i;
        const label = TAB_LABELS[r.name as keyof TabParams];
        return (
          <Pressable
            key={r.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            onPress={() => !on && navigation.navigate(r.name)}
            style={{ flex: 1, minHeight: size.TOUCH_TARGET + 8, alignItems: 'center', justifyContent: 'center', gap: 4 }}
          >
            <View style={{ width: 22, height: 6, borderRadius: 3, backgroundColor: on ? c.ink : 'transparent' }} />
            <Text style={{ fontFamily: font.text700, fontSize: 12, color: on ? c.ink : c.inkTab }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(p) => <TabBar {...p} />}>
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Lists" component={ListsScreen} />
      <Tab.Screen name="Calendar" component={CalendarScreen} />
      <Tab.Screen name="Groups" component={GroupsScreen} />
    </Tab.Navigator>
  );
}

export function RootStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
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
    </Stack.Navigator>
  );
}

export const linking: LinkingOptions<RootStackParams> = {
  prefixes: [`${config.URL_SCHEME}://`],
  config: {
    screens: {
      Tabs: { screens: { Today: 'today', Lists: 'lists', Calendar: 'calendar', Groups: 'groups' } },
      Invite: 'invite/:token',
      List: 'list/:listId',
      Task: 'task/:taskId',
    },
  },
};

export function AppNavigation() {
  const { scheme, c } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer linking={linking} theme={{ ...base, colors: { ...base.colors, background: c.ground, card: c.surface, text: c.ink, border: c.border, primary: c.ink } }}>
      <RootStack />
    </NavigationContainer>
  );
}
