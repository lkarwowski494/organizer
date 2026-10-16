// Widżet iOS „Moje sprawy” (D17, BRD B4).
// Wyświetla najbliższe sprawy i wydarzenia na dziś na ekranie początkowym i ekranie blokady iPhone'a.
import SwiftUI
import WidgetKit

// MARK: - Modele danych

struct WidgetItem: Codable, Identifiable {
  let id: String
  let title: String
  let time: String?
  let kind: String
  let groupName: String
  let groupLine: Int
  let groupColor: String
  let isOverdue: Bool
  let deepLink: String
}

struct WidgetPayload: Codable {
  let version: Int
  let updatedAt: String
  let today: String
  let dayLabel: String
  let totalRemainingCount: Int
  let items: [WidgetItem]
}

// MARK: - Dostawca osi czasu (TimelineProvider)

struct OrganizerTimelineEntry: TimelineEntry {
  let date: Date
  let payload: WidgetPayload?
}

struct OrganizerWidgetProvider: TimelineProvider {
  private let appGroupId = "group.io.github.lkarwowski494.organizer"
  private let suiteKey = "today_widget_data"
  private let fileName = "today-widget.json"

  func placeholder(in context: Context) -> OrganizerTimelineEntry {
    OrganizerTimelineEntry(date: Date(), payload: previewPayload())
  }

  func getSnapshot(in context: Context, completion: @escaping (OrganizerTimelineEntry) -> Void) {
    completion(OrganizerTimelineEntry(date: Date(), payload: loadPayload() ?? previewPayload()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<OrganizerTimelineEntry>) -> Void) {
    let payload = loadPayload()
    let entry = OrganizerTimelineEntry(date: Date(), payload: payload)

    // Odświeżanie osi czasu co 30 minut lub po północy
    let calendar = Calendar.current
    let nextUpdate = calendar.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
    let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
    completion(timeline)
  }

  private func loadPayload() -> WidgetPayload? {
    // 1. Odczyt z UserDefaults współdzielonego App Group
    if let defaults = UserDefaults(suiteName: appGroupId),
       let jsonString = defaults.string(forKey: suiteKey),
       let data = jsonString.data(using: .utf8) {
      if let decoded = try? JSONDecoder().decode(WidgetPayload.self, from: data) {
        return decoded
      }
    }

    // 2. Odczyt rezerwowy z pliku kontenera App Group
    if let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) {
      let fileURL = containerURL.appendingPathComponent(fileName)
      if let data = try? Data(contentsOf: fileURL),
         let decoded = try? JSONDecoder().decode(WidgetPayload.self, from: data) {
        return decoded
      }
    }

    return nil
  }

  private func previewPayload() -> WidgetPayload {
    WidgetPayload(
      version: 1,
      updatedAt: ISO8601DateFormatter().string(from: Date()),
      today: "2026-10-15",
      dayLabel: "Czwartek, 15 października",
      totalRemainingCount: 3,
      items: [
        WidgetItem(
          id: "demo-1",
          title: "Zebranie w szkole",
          time: "16:30–17:30",
          kind: "event",
          groupName: "Rodzina",
          groupLine: 1,
          groupColor: "#0E7C7B",
          isOverdue: false,
          deepLink: "organizer://today"
        ),
        WidgetItem(
          id: "demo-2",
          title: "Kupić mleko i pieczywo",
          time: "18:00",
          kind: "task",
          groupName: "Dom",
          groupLine: 0,
          groupColor: "#E05A47",
          isOverdue: false,
          deepLink: "organizer://today"
        ),
        WidgetItem(
          id: "demo-3",
          title: "Telefon do lekarza",
          time: nil,
          kind: "task",
          groupName: "Osobiste",
          groupLine: 2,
          groupColor: "#D97706",
          isOverdue: true,
          deepLink: "organizer://today"
        )
      ]
    )
  }
}

// MARK: - Pomocnik kolorów Hex

extension Color {
  init(hex: String) {
    let cleanHex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    var int: UInt64 = 0
    Scanner(string: cleanHex).scanHexInt64(&int)
    let a, r, g, b: UInt64
    switch cleanHex.count {
    case 3:
      (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
    case 6:
      (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
    case 8:
      (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
    default:
      (a, r, g, b) = (255, 128, 128, 128)
    }
    self.init(
      .sRGB,
      red: Double(r) / 255,
      green: Double(g) / 255,
      blue: Double(b) / 255,
      opacity: Double(a) / 255
    )
  }
}

// MARK: - Widoki widżetu

struct OrganizerWidgetEntryView: View {
  @Environment(\.widgetFamily) var family
  let entry: OrganizerTimelineEntry

  var body: some View {
    switch family {
    case .systemSmall:
      SmallWidgetView(payload: entry.payload)
        .widgetURL(URL(string: "organizer://today"))
    case .systemMedium:
      MediumWidgetView(payload: entry.payload)
    case .accessoryInline:
      InlineAccessoryView(payload: entry.payload)
    case .accessoryRectangular:
      RectangularAccessoryView(payload: entry.payload)
    default:
      SmallWidgetView(payload: entry.payload)
        .widgetURL(URL(string: "organizer://today"))
    }
  }
}

// MARK: - Mały widżet (systemSmall)

struct SmallWidgetView: View {
  let payload: WidgetPayload?

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("Moje sprawy")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(.secondary)
        Spacer()
        Image(systemName: "checklist")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(.secondary)
      }

      if let p = payload {
        if p.totalRemainingCount == 0 {
          Spacer()
          VStack(alignment: .leading, spacing: 4) {
            Image(systemName: "checkmark.circle.fill")
              .font(.system(size: 24))
              .foregroundColor(.green)
            Text("Wszystko zrobione!")
              .font(.system(size: 14, weight: .medium))
              .foregroundColor(.primary)
          }
          Spacer()
        } else {
          HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(p.totalRemainingCount)")
              .font(.system(size: 32, weight: .bold))
              .foregroundColor(.primary)
            Text(p.totalRemainingCount == 1 ? "sprawa" : "sprawy")
              .font(.system(size: 13, weight: .medium))
              .foregroundColor(.secondary)
          }

          if let first = p.items.first {
            Spacer()
            VStack(alignment: .leading, spacing: 2) {
              HStack(spacing: 4) {
                Circle()
                  .fill(Color(hex: first.groupColor))
                  .frame(width: 6, height: 6)
                Text(first.groupName)
                  .font(.system(size: 11, weight: .semibold))
                  .foregroundColor(.secondary)
                  .lineLimit(1)
              }
              Text(first.title)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.primary)
                .lineLimit(2)
              if let time = first.time {
                Text(time)
                  .font(.system(size: 11, weight: .regular))
                  .foregroundColor(first.isOverdue ? .red : .secondary)
              }
            }
          }
        }
      } else {
        Spacer()
        Text("Zaloguj się w aplikacji")
          .font(.system(size: 13, weight: .medium))
          .foregroundColor(.secondary)
        Spacer()
      }
    }
    .padding(14)
  }
}

// MARK: - Średni widżet (systemMedium)

struct MediumWidgetView: View {
  let payload: WidgetPayload?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      // Nagłówek
      HStack {
        VStack(alignment: .leading, spacing: 1) {
          Text("Moje sprawy")
            .font(.system(size: 13, weight: .bold))
            .foregroundColor(.primary)
          if let label = payload?.dayLabel {
            Text(label)
              .font(.system(size: 11, weight: .regular))
              .foregroundColor(.secondary)
          }
        }
        Spacer()
        if let p = payload {
          Text("\(p.totalRemainingCount) na dziś")
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Color.secondary.opacity(0.15))
            .cornerRadius(10)
        }
      }

      Divider()

      // Lista pozycji
      if let p = payload {
        if p.items.isEmpty {
          Spacer()
          HStack {
            Spacer()
            VStack(spacing: 4) {
              Image(systemName: "checkmark.circle")
                .font(.system(size: 20))
                .foregroundColor(.green)
              Text("Wszystko zrobione na dziś!")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.secondary)
            }
            Spacer()
          }
          Spacer()
        } else {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(p.items.prefix(3)) { item in
              Link(destination: URL(string: item.deepLink) ?? URL(string: "organizer://today")!) {
                HStack(spacing: 8) {
                  RoundedRectangle(cornerRadius: 2)
                    .fill(Color(hex: item.groupColor))
                    .frame(width: 4, height: 18)

                  Text(item.title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.primary)
                    .lineLimit(1)

                  Spacer()

                  if item.isOverdue {
                    Text("zaległe")
                      .font(.system(size: 11, weight: .medium))
                      .foregroundColor(.red)
                  } else if let time = item.time {
                    Text(time)
                      .font(.system(size: 11, weight: .regular))
                      .foregroundColor(.secondary)
                  }
                }
              }
            }
          }
        }
      } else {
        Spacer()
        Text("Otwórz Organizer, aby załadować sprawy.")
          .font(.system(size: 12, weight: .medium))
          .foregroundColor(.secondary)
        Spacer()
      }
    }
    .padding(14)
  }
}

// MARK: - Widżety ekranu blokady (Accessory)

struct InlineAccessoryView: View {
  let payload: WidgetPayload?

  var body: some View {
    if let p = payload {
      Text("Organizer: \(p.totalRemainingCount) spraw")
    } else {
      Text("Organizer")
    }
  }
}

struct RectangularAccessoryView: View {
  let payload: WidgetPayload?

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack {
        Text("Moje sprawy")
          .font(.system(size: 11, weight: .bold))
        Spacer()
        if let count = payload?.totalRemainingCount {
          Text("\(count)")
            .font(.system(size: 11, weight: .bold))
        }
      }
      if let first = payload?.items.first {
        Text(first.title)
          .font(.system(size: 12, weight: .medium))
          .lineLimit(1)
        if let time = first.time {
          Text(time)
            .font(.system(size: 10, weight: .regular))
            .foregroundColor(.secondary)
        } else {
          Text(first.groupName)
            .font(.system(size: 10, weight: .regular))
            .foregroundColor(.secondary)
        }
      } else {
        Text("Brak spraw na dziś")
          .font(.system(size: 11, weight: .regular))
          .foregroundColor(.secondary)
      }
    }
  }
}

// MARK: - Główny Bundle Widżetów

@main
struct OrganizerWidgetsBundle: WidgetBundle {
  var body: some Widget {
    OrganizerTodayWidget()
  }
}

struct OrganizerTodayWidget: Widget {
  let kind: String = "OrganizerTodayWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: OrganizerWidgetProvider()) { entry in
      OrganizerWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Moje sprawy")
    .description("Najbliższe sprawy i wydarzenia z Twoich grup na dziś.")
    .supportedFamilies([
      .systemSmall,
      .systemMedium,
      .accessoryInline,
      .accessoryRectangular
    ])
  }
}
