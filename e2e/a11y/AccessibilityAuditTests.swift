// Automatyczny audyt dostępności na symulatorze (decyzja D186, audyt 2 M-153): jeden scenariusz na ekran, na buildzie
// E2E z danymi demo (src/app/e2e.ts), po scenariuszach Maestro w e2e.yml. Uruchamia: scripts/e2e/a11y-audit.sh.
//
// API (przeczytane 8.10.2026, https://developer.apple.com/documentation/xcuiautomation/xcuiapplication/performaccessibilityaudit(for:_:)):
//   func performAccessibilityAudit(for auditTypes: XCUIAccessibilityAuditType = .all,
//                                  _ issueHandler: ((XCUIAccessibilityAuditIssue) throws -> Bool)? = nil) throws
// (iOS 17.0+). Rodzaje: contrast, dynamicType, elementDetection, hitRegion, sufficientElementDescription, textClipped,
// trait, action, parentChild (XCUIAccessibilityAuditType). Każdy znaleziony problem oblewa test (bez issueHandler).
// Aplikację uruchamiamy po identyfikatorze pakietu — test nie ma własnej aplikacji docelowej; dokumentacja
// init(bundleIdentifier:): „If the system can’t find the matching app build, it launches the existing installed app
// for the requested bundle ID” (build E2E zainstalował wcześniej scripts/e2e/run-flows.sh).
// Selektory: identyfikator = testID z ekranów, etykieta = accessibilityLabel (jak w .maestro/).
import XCTest

final class AccessibilityAuditTests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    app = XCUIApplication(bundleIdentifier: "io.github.lkarwowski494.organizer")
    app.terminate()
    app.launch() // tryb E2E: świeża baza i „serwer” w pamięci przy każdym starcie
    XCTAssertTrue(element("screen-today").waitForExistence(timeout: 60), "„Moje sprawy” nie pojawiły się")
    XCTAssertTrue(label(beginsWith: "Otwórz: Oddać książki do biblioteki").waitForExistence(timeout: 20), "brak danych demo")
  }

  private func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

  private func label(beginsWith prefix: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
  }

  private func open(_ id: String) {
    let e = element(id)
    XCTAssertTrue(e.waitForExistence(timeout: 10), "brak \(id)")
    e.tap()
  }

  private func audit(_ screen: String, file: StaticString = #filePath, line: UInt = #line) throws {
    XCTAssertTrue(element(screen).waitForExistence(timeout: 10), "brak ekranu \(screen)", file: file, line: line)
    try app.performAccessibilityAudit()
  }

  func testMojeSprawy() throws { try audit("screen-today") }

  func testMojeSprawyTydzien() throws {
    app.buttons["Tydzień"].tap()
    try audit("screen-today")
  }

  func testZadanie() throws {
    label(beginsWith: "Otwórz: Odebrać paczkę").tap()
    try audit("screen-task")
  }

  func testPelnyFormularzZadania() throws {
    open("add-more")
    try audit("screen-add-task")
  }

  func testListy() throws {
    open("tab-Lists")
    try audit("screen-lists")
  }

  func testListaZadan() throws {
    open("tab-Lists")
    open("list-0199a000-0000-7000-8000-000000000021")
    try audit("screen-list")
  }

  func testListaZakupow() throws {
    open("tab-Lists")
    open("list-0199a000-0000-7000-8000-000000000022")
    try audit("screen-list")
  }

  func testKalendarz() throws {
    open("tab-Calendar")
    try audit("screen-calendar")
  }

  func testWydarzenie() throws {
    open("today-event-0199a000-0000-7000-8000-000000000030-2026-10-07")
    try audit("screen-event")
  }

  func testNoweWydarzenie() throws {
    open("tab-Calendar")
    open("calendar-add-event")
    try audit("screen-event-edit")
  }

  func testGrupy() throws {
    open("tab-Groups")
    try audit("screen-groups")
  }

  func testGrupa() throws {
    open("tab-Groups")
    open("group-0199a000-0000-7000-8000-000000000010")
    try audit("screen-group")
  }

  func testUstawienia() throws {
    app.buttons["Ustawienia"].firstMatch.tap()
    try audit("screen-settings")
  }

  func testUstawieniaKonto() throws {
    app.buttons["Ustawienia"].firstMatch.tap()
    app.buttons["Konto i dane"].firstMatch.tap()
    try audit("screen-settings-account")
  }
}
