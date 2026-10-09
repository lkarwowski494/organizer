# Projekt Xcode z jednym pakietem testów interfejsu (audyt dostępności, D186) — tworzony w CI gemem xcodeproj
# (https://github.com/CocoaPods/Xcodeproj; jest na runnerze razem z CocoaPods, którego używa `expo prebuild`).
# Bez aplikacji docelowej: test uruchamia zainstalowany build E2E po identyfikatorze pakietu.
# Użycie: ruby e2e/a11y/make-project.rb <katalog wyjściowy>
require 'xcodeproj'
require 'fileutils'

out = ARGV.fetch(0)
FileUtils.mkdir_p(out)
src = File.expand_path('AccessibilityAuditTests.swift', __dir__)
FileUtils.cp(src, out)
path = File.join(out, 'OrganizerA11yAudit.xcodeproj')
project = Xcodeproj::Project.new(path)
target = project.new_target(:ui_test_bundle, 'OrganizerA11yAudit', :ios, '17.0')
target.add_file_references([project.new_file(File.join(out, 'AccessibilityAuditTests.swift'))])
target.build_configurations.each do |c|
  c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'io.github.lkarwowski494.organizer.a11yaudit'
  c.build_settings['SWIFT_VERSION'] = '5.0'
  c.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  c.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
  c.build_settings['TEST_TARGET_NAME'] = ''
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_test_target(target)
scheme.save_as(path, 'OrganizerA11yAudit', true)
puts path
