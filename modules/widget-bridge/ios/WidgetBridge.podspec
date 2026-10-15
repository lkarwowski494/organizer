# Mostek widżetu iOS (D17, BRD B4): lokalny moduł Expo, zapis danych do App Group i WidgetKit.
Pod::Spec.new do |s|
  s.name           = 'WidgetBridge'
  s.version        = '1.0.0'
  s.summary        = 'Mostek widżetu (WidgetKit) dla Organizera'
  s.description    = 'Zapis zrzutu danych do App Group i przeładowanie osi czasu widżetów.'
  s.license        = 'UNLICENSED'
  s.author         = 'Organizer'
  s.homepage       = 'https://github.com/lkarwowski494/organizer'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/lkarwowski494/organizer.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
