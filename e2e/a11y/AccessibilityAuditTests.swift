// Automatyczny audyt dostępności na symulatorze (decyzja D186, audyt 2 M-153): jeden scenariusz na ekran, na buildzie
// E2E z danymi demo (src/app/e2e.ts), po scenariuszach Maestro w e2e.yml. Uruchamia: scripts/e2e/a11y-audit.sh.
//
// API (przeczytane 8.10.2026, https://developer.apple.com/documentation/xcuiautomation/xcuiapplication/performaccessibilityaudit(for:_:)):
//   func performAccessibilityAudit(for auditTypes: XCUIAccessibilityAuditType = .all,
//                                  _ issueHandler: ((XCUIAccessibilityAuditIssue) throws -> Bool)? = nil) throws
// (iOS 17.0+). Rodzaje: contrast, dynamicType, elementDetection, hitRegion, sufficientElementDescription, textClipped,
// trait, action, parentChild (XCUIAccessibilityAuditType). Każdy znaleziony problem oblewa test: issueHandler zwraca
// false (true pomija problem — niżej), a wcześniej wypisuje problem z elementem (wiersz „A11Y-ISSUE”, który
// a11y-audit.sh przenosi do logu kroku) — sam komunikat XCTest („Potentially inaccessible text”) nie mówi, który
// element (przebiegi e2e 57 i 58 z 9.10.2026). Pola problemu: auditType, compactDescription, detailedDescription,
// element (XCUIElement?) — https://developer.apple.com/documentation/xcuiautomation/xcuiaccessibilityauditissue.
// Jedyny wyjątek: element klawiatury systemowej (rysuje ją iOS; aplikacja nie ma na nią wpływu). „Element has no
// description” zgłaszał audyt tylko na dwóch ekranach z polem z autoFocus („Nowe wydarzenie”, pełny formularz zadania)
// i tylko w części przebiegów z tym samym kodem — gdy klawiatura zdążyła się wysunąć (przebiegi e2e 57–59).
// Pominięcie według Apple (WWDC23, adres niżej): „you may run into issues which should be filtered out and ignored”,
// „Setting it to true indicates that I'd like the issue to be ignored”. Pominięty problem też trafia do logu.
// continueAfterFailure = true w audycie: zgłoszone są wszystkie problemy ekranu, nie tylko pierwszy (WWDC23
// „Perform accessibility audits for your app”: „The audit can report multiple issues, so to allow my test to continue
// reporting issues after the first failure, I'll set continueAfterFailure to true”,
// https://developer.apple.com/videos/play/wwdc2023/10035/).
// Aplikację uruchamiamy po identyfikatorze pakietu — test nie ma własnej aplikacji docelowej; dokumentacja
// init(bundleIdentifier:): „If the system can’t find the matching app build, it launches the existing installed app
// for the requested bundle ID” (build E2E zainstalował wcześniej scripts/e2e/run-flows.sh).
// Selektory: identyfikator = testID z ekranów, etykieta = accessibilityLabel (jak w .maestro/). Etykieta wiersza zaczyna się
// od tytułu, czynność jest w podpowiedzi (audyt 2, M-263) — te same początki co w .maestro/common/launch.yaml; zgodność
// z ekranami sprawdza src/app/__tests__/e2e.screens.test.tsx.
import XCTest

final class AccessibilityAuditTests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    app = XCUIApplication(bundleIdentifier: "io.github.lkarwowski494.organizer")
    app.terminate()
    app.launch() // tryb E2E: świeża baza i „serwer” w pamięci przy każdym starcie
    XCTAssertTrue(element("screen-today").waitForExistence(timeout: 60), "„Moje sprawy” nie pojawiły się")
    XCTAssertTrue(label(beginsWith: "Oddać książki do biblioteki,").waitForExistence(timeout: 20), "brak danych demo")
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

  /// Koniec przejścia i wysuwania klawiatury: dwa kolejne opisy drzewa (z ramkami elementów) takie same, najwyżej 10 s.
  /// Bez tego wynik zależał od chwili: ten sam commit raz bez problemów, raz „Element has no description” na „Nowym
  /// wydarzeniu” (pole nazwy ma autoFocus, klawiatura się wysuwa) — teraz audyt widzi zawsze ekran po animacji.
  private func settle() {
    var last = ""
    let deadline = Date().addingTimeInterval(10)
    while Date() < deadline {
      let now = app.debugDescription
      if now == last { return }
      last = now
      Thread.sleep(forTimeInterval: 0.5)
    }
  }

  /// Element klawiatury systemowej (ten sam typ i ramka co element z `app.keyboards`) — rysuje ją iOS, nie aplikacja.
  private func inSystemKeyboard(_ e: XCUIElement) -> Bool {
    let keyboard = app.keyboards.firstMatch
    guard keyboard.exists else { return false }
    if e.elementType == .keyboard { return true }
    return keyboard.descendants(matching: .any).allElementsBoundByIndex.contains { $0.elementType == e.elementType && $0.frame == e.frame }
  }

  private func describe(_ issue: XCUIAccessibilityAuditIssue, keyboard: Bool) -> String {
    let flat = { (s: String) in s.replacingOccurrences(of: "\n", with: " ") }
    var parts = ["A11Y-ISSUE", name, flat(issue.compactDescription), flat(issue.detailedDescription), "auditType=\(issue.auditType.rawValue)"]
    if let e = issue.element, e.exists {
      parts.append("element: type=\(e.elementType.rawValue) id=\"\(e.identifier)\" label=\"\(flat(e.label))\" value=\"\(flat(String(describing: e.value ?? "")))\" frame=\(e.frame)")
    } else {
      parts.append("element: brak")
    }
    if keyboard { parts.append("POMINIĘTE: klawiatura systemowa") }
    return parts.joined(separator: " | ")
  }

  private func audit(_ screen: String, file: StaticString = #filePath, line: UInt = #line) throws {
    XCTAssertTrue(element(screen).waitForExistence(timeout: 10), "brak ekranu \(screen)", file: file, line: line)
    settle()
    continueAfterFailure = true
    try app.performAccessibilityAudit { issue in
      let keyboard = issue.element.map { $0.exists && self.inSystemKeyboard($0) } ?? false
      print(self.describe(issue, keyboard: keyboard))
      return keyboard
    }
  }

  func testMojeSprawy() throws { try audit("screen-today") }

  func testMojeSprawyTydzien() throws {
    app.buttons["Tydzień"].tap()
    try audit("screen-today")
  }

  func testZadanie() throws {
    label(beginsWith: "Odebrać paczkę,").tap()
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
