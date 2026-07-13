import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";

/**
 * Adds the built-in "locate me" control (button -> geolocate -> marker -> ease) to a map. Factored
 * out of the community map so every interactive map gets the exact same behavior. Returns a cleanup
 * function that removes the control -- call it from the caller's `useEffect` teardown.
 */
export function addGeolocateControl(map: MapLibreMap): () => void {
  const ctl = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: false,
    showAccuracyCircle: true,
  });
  map.addControl(ctl, "top-right");
  return () => {
    map.removeControl(ctl);
  };
}
