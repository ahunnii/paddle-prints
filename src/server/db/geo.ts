import { customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { Geometry } from "wkx";
import type { LineString, Point } from "geojson";

/**
 * Drizzle `customType` factory for a PostGIS `geometry(LineString,4326)` column.
 *
 * Values are read/written as GeoJSON on the JS side; PostGIS handles the WKB <-> GeoJSON
 * conversion via `ST_GeomFromGeoJSON` on write and we parse the WKB hex string with `wkx` on read.
 */
export const lineString = (name: string) =>
  customType<{ data: LineString; driverData: string }>({
    dataType() {
      return "geometry(LineString,4326)";
    },
    toDriver(value) {
      return sql`ST_GeomFromGeoJSON(${JSON.stringify(value)})`;
    },
    fromDriver(value) {
      return Geometry.parse(Buffer.from(value, "hex")).toGeoJSON() as LineString;
    },
  })(name);

/**
 * Drizzle `customType` factory for a PostGIS `geometry(Point,4326)` column.
 */
export const geoPoint = (name: string) =>
  customType<{ data: Point; driverData: string }>({
    dataType() {
      return "geometry(Point,4326)";
    },
    toDriver(value) {
      return sql`ST_GeomFromGeoJSON(${JSON.stringify(value)})`;
    },
    fromDriver(value) {
      return Geometry.parse(Buffer.from(value, "hex")).toGeoJSON() as Point;
    },
  })(name);
