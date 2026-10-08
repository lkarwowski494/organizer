# Czas dojazdu z Map Apple (D116, ADR 0029): lokalny moduł Expo, MapKit MKDirections.calculateETA.
Pod::Spec.new do |s|
  s.name           = 'TravelTime'
  s.version        = '1.0.0'
  s.summary        = 'Czas dojazdu (MapKit) dla Organizera'
  s.description    = 'Szacowany czas dojazdu samochodem, komunikacją albo pieszo z MKDirections.calculateETA.'
  s.license        = 'UNLICENSED'
  s.author         = 'Organizer'
  s.homepage       = 'https://github.com/lkarwowski494/organizer'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/lkarwowski494/organizer.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MapKit', 'CoreLocation'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
