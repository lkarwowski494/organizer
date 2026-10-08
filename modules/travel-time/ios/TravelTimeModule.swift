// Czas dojazdu z Map Apple (D116, ADR 0029). MKDirections.calculateETA — dokumentacja:
// https://developer.apple.com/documentation/mapkit/mkdirections/calculateeta(completionhandler:)
// Liczy telefon (serwery Apple przez MapKit), bez kluczy i opłat. Za dużo zapytań naraz → MKError.loadingThrottled.
import CoreLocation
import ExpoModulesCore
import MapKit

final internal class TravelTimeUnavailableException: GenericException<String> {
  override var reason: String {
    "travel_time_unavailable: \(param)"
  }
}

public class TravelTimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TravelTime")

    // Skąd (współrzędne telefonu), dokąd (współrzędne celu), środek transportu, chwila wyjazdu (ms od 1970).
    AsyncFunction("eta") { (fromLat: Double, fromLng: Double, toLat: Double, toLng: Double, mode: String, departureMs: Double) async throws -> Double in
      let request = MKDirections.Request()
      request.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: fromLat, longitude: fromLng)))
      request.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: toLat, longitude: toLng)))
      switch mode {
      case "walking":
        request.transportType = .walking
      case "transit":
        request.transportType = .transit
      default:
        request.transportType = .automobile
      }
      request.departureDate = Date(timeIntervalSince1970: departureMs / 1000)
      do {
        let response = try await MKDirections(request: request).calculateETA()
        return response.expectedTravelTime
      } catch {
        throw TravelTimeUnavailableException(error.localizedDescription)
      }
    }
  }
}
