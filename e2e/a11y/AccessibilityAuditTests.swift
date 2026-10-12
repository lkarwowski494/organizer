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
// Drugi wyjątek (nocny przebieg e2e 38106362581, 11.10.2026): komórki paska podpowiedzi klawiatury systemowej
// („This TUIPredictionViewCell is missing useful accessibility information”, rodzaj sufficientElementDescription, element
// typu .other w pasku nad klawiaturą, ramki (0|130|260, 509, 130, 44) na iPhonie 17e). Pasek nie jest potomkiem
// `app.keyboards`, więc pierwszy wyjątek go nie łapał. Klasa TUIPredictionViewCell należy do systemu (TextInputUI),
// nie do aplikacji — aplikacja nie tworzy tych komórek. Wyłączenie podpowiedzi w symulatorze nie działa:
// scripts/e2e/boot-simulator.sh zapisuje `KeyboardPrediction` = false, a komórki i tak są (przebiegi 38106362581
// i 38167222893). Dlatego filtr wąski, jak w przykładzie Apple (rodzaj problemu + cecha elementu): tylko ten rodzaj,
// tylko ta klasa w opisie i tylko przy widocznej klawiaturze; każdy inny problem nadal oblewa test.
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

  /// Dotknięcie po końcu animacji. Nocny przebieg 38106362581 (11.10.2026): testGrupy — „brak ekranu screen-groups”
  /// 10 s po dotknięciu zakładki, na symulatorze ponownie uruchomionym po wariantach Pro Max (każdy test ok. 1,5 raza
  /// wolniej niż w przebiegu po pushu, gdzie testGrupy przeszedł w 20 s). Bez zrzutu nie dało się rozstrzygnąć, czy
  /// dotknięcie trafiło w trakcie przejścia, czy ekran się nie otworzył — dlatego dotyk dopiero po settle() i zrzut
  /// ekranu przy braku ekranu (zapamiętany w wynikach testu; a11y-audit.sh kopiuje go do artefaktu).
  /// Przebieg 38171092887: testListaZadan i testListaZakupow — „brak list-…” 10 s po otwarciu zakładki Listy (testListy
  /// w tym samym przebiegu przeszedł) — bez zrzutu; teraz 20 s i zrzut przy braku elementu.
  private func open(_ id: String, file: StaticString = #filePath, line: UInt = #line) {
    let e = element(id)
    expectElement(id, message: "brak \(id)", timeout: 20, file: file, line: line)
    settle()
    e.tap()
  }

  private func expectScreen(_ screen: String, file: StaticString, line: UInt) {
    expectElement(screen, message: "brak ekranu \(screen)", timeout: 10, file: file, line: line)
  }

  private func expectElement(_ id: String, message: String, timeout: TimeInterval, file: StaticString, line: UInt) {
    if element(id).waitForExistence(timeout: timeout) { return }
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "brak-\(id)"
    shot.lifetime = .keepAlways
    add(shot)
    XCTFail(message, file: file, line: line)
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

  /// Komórka paska podpowiedzi klawiatury systemowej (TUIPredictionViewCell) bez opisu — rysuje ją iOS nad klawiaturą.
  /// WWDC23 „Perform accessibility audits for your app”: „You can extend this example and customize the criteria for
  /// ignoring by using other properties, like the element type” (https://developer.apple.com/videos/play/wwdc2023/10035/).
  private func systemPrediction(_ issue: XCUIAccessibilityAuditIssue) -> Bool {
    issue.auditType == .sufficientElementDescription
      && issue.detailedDescription.contains("TUIPredictionViewCell")
      && app.keyboards.firstMatch.exists
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

  /// Audyt, który nie zdążył się skończyć (błąd XCTest „Audit failed to complete in time”, domena
  /// com.apple.xcode.xctest.accessibilityAudit, kod -56; E2E 38220289381: testGrupy i testMojeSprawy po 2 h wariantów,
  /// testMojeSprawyTydzien na tym samym ekranie przeszedł) nie daje wyniku — ani problemów, ani ich braku. Wtedy jeden
  /// raz od nowa, po końcu animacji, z wierszem „A11Y-RETRY” w logu. Problemy zgłoszone w pierwszej próbie zostają
  /// porażkami testu (handler zwraca false), a druga przekroczona próba oblewa test tym samym błędem.
  private func audit(_ screen: String, file: StaticString = #filePath, line: UInt = #line) throws {
    expectScreen(screen, file: file, line: line)
    settle()
    continueAfterFailure = true
    do {
      try runAudit()
    } catch let e as NSError where e.domain == "com.apple.xcode.xctest.accessibilityAudit" && e.code == -56 {
      print("A11Y-RETRY | \(name) | \(e.localizedDescription)")
      settle()
      try runAudit()
    }
  }

  private func runAudit() throws {
    try app.performAccessibilityAudit { issue in
      let keyboard = (issue.element.map { $0.exists && self.inSystemKeyboard($0) } ?? false) || self.systemPrediction(issue)
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
