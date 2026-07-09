/** Minimal ambient types for @mapbox/tile-cover (ships no declarations). */
declare module "@mapbox/tile-cover" {
  /** Cells covering `geom` across the zoom range, each as `[x, y, z]`. */
  export function tiles(
    geom: GeoJSON.Geometry,
    limits: { min_zoom: number; max_zoom: number },
  ): Array<[number, number, number]>;

  export function indexes(
    geom: GeoJSON.Geometry,
    limits: { min_zoom: number; max_zoom: number },
  ): string[];

  export function geojson(
    geom: GeoJSON.Geometry,
    limits: { min_zoom: number; max_zoom: number },
  ): GeoJSON.FeatureCollection;
}
