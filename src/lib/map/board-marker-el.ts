/**
 * The HTML marker element for the live paddleboard position: a small north-up SVG board (so that
 * `rotationAlignment: "map"` + `marker.setRotation(headingDeg)` points it the way the paddler is
 * heading) plus an optional name pill underneath for presence markers on the community map.
 * DOM-only -- only ever invoked from client components that hand it to a maplibre `Marker`.
 */
export function createBoardMarkerEl(opts: { label?: string } = {}): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "flex flex-col items-center";

  wrapper.innerHTML = `
    <svg
      width="22"
      height="44"
      viewBox="0 0 24 48"
      xmlns="http://www.w3.org/2000/svg"
      style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.45))"
    >
      <path
        d="M12 1
           C 18 1 21 10 21 22
           C 21 32 19 42 15 46
           C 13.5 47.5 10.5 47.5 9 46
           C 5 42 3 32 3 22
           C 3 10 6 1 12 1 Z"
        fill="#f97316"
        stroke="#ffffff"
        stroke-width="2"
      />
      <path
        d="M12 6
           C 15.5 6 17.2 13 17.2 22
           C 17.2 30 15.8 38 13 42
           C 12.5 42.6 11.5 42.6 11 42
           C 8.2 38 6.8 30 6.8 22
           C 6.8 13 8.5 6 12 6 Z"
        fill="#fdba74"
      />
      <circle cx="12" cy="26" r="3.2" fill="#ffffff" />
    </svg>
  `;

  if (opts.label) {
    const pill = document.createElement("div");
    pill.className =
      "mt-0.5 whitespace-nowrap rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white";
    pill.textContent = opts.label;
    wrapper.appendChild(pill);
  }

  return wrapper;
}
