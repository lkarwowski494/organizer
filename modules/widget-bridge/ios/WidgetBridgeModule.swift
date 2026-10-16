// Mostek widżetu iOS (D17, BRD B4): zapis zrzutu danych do UserDefaults współdzielonego App Group
// oraz do pliku w kontenerze grupy, po czym powiadomienie WidgetCenter o przeładowaniu osi czasu widżetów.
import ExpoModulesCore
import WidgetKit

public class WidgetBridgeModule: Module {
  private let appGroupId = "group.io.github.lkarwowski494.organizer"
  private let suiteKey = "today_widget_data"
  private let fileName = "today-widget.json"

  public func definition() -> ModuleDefinition {
    Name("WidgetBridge")

    Function("updateSnapshot") { (json: String) in
      if let defaults = UserDefaults(suiteName: self.appGroupId) {
        defaults.set(json, forKey: self.suiteKey)
      }
      if let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: self.appGroupId) {
        let fileURL = containerURL.appendingPathComponent(self.fileName)
        try? json.write(to: fileURL, atomically: true, encoding: .utf8)
      }
      WidgetCenter.shared.reloadAllTimelines()
    }

    Function("clearSnapshot") {
      if let defaults = UserDefaults(suiteName: self.appGroupId) {
        defaults.removeObject(forKey: self.suiteKey)
      }
      if let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: self.appGroupId) {
        let fileURL = containerURL.appendingPathComponent(self.fileName)
        try? FileManager.default.removeItem(at: fileURL)
      }
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
