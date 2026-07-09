import { poiMeta } from "~/lib/pois";

/**
 * The HTML marker element for a POI: a white rounded pill with the category emoji, a subtle shadow,
 * and a category-colored ring. DOM-only -- only ever invoked from client components that hand it to
 * a maplibre `Marker`.
 */
export function createPoiMarkerEl(category: string, size = 34): HTMLDivElement {
  const meta = poiMeta(category);
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", meta.label);
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "9999px";
  el.style.background = "#ffffff";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.fontSize = `${Math.round(size * 0.5)}px`;
  el.style.lineHeight = "1";
  el.style.boxShadow = `0 2px 6px rgba(0,0,0,0.35), 0 0 0 2px ${meta.color}`;
  el.style.cursor = "pointer";
  el.textContent = meta.emoji;
  return el;
}
