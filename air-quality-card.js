// ============================================================
// Constants
// ============================================================
const VERSION = '0.1.0';

// Pollutant tile thresholds: { good, mod, high } in the sensor's native unit.
// Sources:
//   PM1   - WHO 2021 AQG (no formal limit; values aligned with PM2.5 short-term band)
//   PM2.5 - US EPA NAAQS: 12 ug/m3 annual, 35 ug/m3 24-hour, ~75 ug/m3 unhealthy
//   PM4   - extrapolated between PM2.5 and PM10 (no formal standard)
//   PM10  - WHO 2021 AQG 24-hour 50 ug/m3, US EPA NAAQS 24-hour 150 ug/m3
//   VOC   - Sensirion VOC Index (0-500, baseline 100). NOT valid for TVOC sensors
//           reporting ppb or ug/m3 - see issue tracker for the open discussion.
//   CO2   - ASHRAE 62.1 ventilation guidance ~1000 ppm, Harvard COGfx cognitive
//           impact threshold ~2000 ppm
const POLLUTANT_THRESHOLDS = {
  pm1:  { good: 10,  mod: 25,   high: 50   },
  pm25: { good: 12,  mod: 35,   high: 75   },
  pm4:  { good: 20,  mod: 50,   high: 100  },
  pm10: { good: 50,  mod: 150,  high: 250  },
  voc:  { good: 100, mod: 200,  high: 300  },
  co2:  { good: 800, mod: 1200, high: 2000 },
};

// US EPA AirNow AQI bands (https://www.airnow.gov/aqi/aqi-basics/).
//   color: bright tint for the ring, chip background, dot, tile bars
//   text:  darker variant used wherever the band color is foreground text
// Both are exposed as CSS custom properties so users can override them
// in their theme YAML, card_mod, or :host overrides. Defaults: Tailwind
// 200/300 (color) and 600 (text). The text variants give ~4:1 contrast
// on light theme where the bright tints fail WCAG AA.
const AQI_BANDS = [
  { max: 50,       color: 'var(--air-quality-card-good-color, #86efac)',           text: 'var(--air-quality-card-good-text, #16a34a)',           label: 'Good',           advice: 'Air quality is satisfactory.' },
  { max: 100,      color: 'var(--air-quality-card-moderate-color, #fde68a)',       text: 'var(--air-quality-card-moderate-text, #ca8a04)',       label: 'Moderate',       advice: 'Acceptable air quality.' },
  { max: 150,      color: 'var(--air-quality-card-unhealthy-sg-color, #fdba74)',   text: 'var(--air-quality-card-unhealthy-sg-text, #ea580c)',   label: 'Unhealthy (SG)', advice: 'Sensitive groups may be affected.' },
  { max: 200,      color: 'var(--air-quality-card-unhealthy-color, #fca5a5)',      text: 'var(--air-quality-card-unhealthy-text, #dc2626)',      label: 'Unhealthy',      advice: 'Everyone may experience health effects.' },
  { max: 300,      color: 'var(--air-quality-card-very-unhealthy-color, #d8b4fe)', text: 'var(--air-quality-card-very-unhealthy-text, #9333ea)', label: 'V. Unhealthy',   advice: 'Health alert: risk is increased.' },
  { max: Infinity, color: 'var(--air-quality-card-hazardous-color, #fda4af)',      text: 'var(--air-quality-card-hazardous-text, #e11d48)',      label: 'Hazardous',      advice: 'Emergency health warning.' },
];

// Internal score-mode bands (lower is worse, 0-100 scale). Colors map
// to the same custom-property family as AQI_BANDS for consistency.
const SCORE_BANDS = [
  { min: 80,        color: 'var(--air-quality-card-good-color, #86efac)',     text: 'var(--air-quality-card-good-text, #16a34a)',     label: 'Good',     advice: 'Air quality is good' },
  { min: 60,        color: 'var(--air-quality-card-moderate-color, #fde68a)', text: 'var(--air-quality-card-moderate-text, #ca8a04)', label: 'Moderate', advice: 'Air quality is moderate' },
  { min: 40,        color: 'var(--air-quality-card-poor-color, #fdba74)',     text: 'var(--air-quality-card-poor-text, #ea580c)',     label: 'Poor',     advice: 'Consider ventilating' },
  { min: -Infinity, color: 'var(--air-quality-card-bad-color, #fca5a5)',      text: 'var(--air-quality-card-bad-text, #dc2626)',      label: 'Bad',      advice: 'Ventilate now' },
];

// Translatable strings for the card-rendered UI. Translators can add a
// new top-level key (e.g. STRINGS.de) mirroring the 'en' shape and the
// card will pick it up automatically based on hass.locale.language.
// AQI/score band labels and advice stay on the band tables themselves
// for now; localizing those is a separate, larger pass.
const STRINGS = {
  en: {
    topName: { aqi: 'AQI Sensor', score: 'Calculated Score' },
    subtitle: 'Climate · Air Quality',
    ring: { aqi: 'AQI', score: 'SCORE' },
    stats: { temp: 'TEMP', humidity: 'HUMIDITY' },
    advice: {
      vocHigh:     'VOCs detected',
      co2High:     'CO2 high - open a window',
      co2VeryHigh: 'CO2 very high - ventilate',
    },
  },
};

// Pure helpers - extracted from the class so they can be unit-tested
// without spinning up a DOM. See test/score.test.mjs.

// color = bright tint for bar fill, text = readable on both themes.
// Both routed through CSS custom properties (defaults match the band
// tables above).
function calcThreshold(value, good, mod, high) {
  if (value == null) return { label: '--',     color: 'var(--divider-color, #444)', text: 'var(--secondary-text-color)', pct: 0 };
  if (value <= good) return { label: 'GOOD',   color: 'var(--air-quality-card-good-color, #86efac)',         text: 'var(--air-quality-card-good-text, #16a34a)',         pct: Math.min(100, (value / high) * 100) };
  if (value <= mod)  return { label: 'MOD',    color: 'var(--air-quality-card-moderate-color, #fde68a)',     text: 'var(--air-quality-card-moderate-text, #ca8a04)',     pct: Math.min(100, (value / high) * 100) };
  if (value <= high) return { label: 'HIGH',   color: 'var(--air-quality-card-unhealthy-sg-color, #fdba74)', text: 'var(--air-quality-card-unhealthy-sg-text, #ea580c)', pct: Math.min(100, (value / high) * 100) };
  return                    { label: 'V.HIGH', color: 'var(--air-quality-card-unhealthy-color, #fca5a5)',    text: 'var(--air-quality-card-unhealthy-text, #dc2626)',    pct: 100 };
}

// Computes the calculated-score-mode headline state from the three
// contributing pollutants. Each pollutant contributes a penalty fraction
// in [0, 1] times its weight. Missing pollutants are dropped and the
// remaining weights renormalize to 100, so a partial sensor set still
// spans 0-100 instead of getting an artificial ceiling.
//
// Divisor calibration (the value at which a pollutant's penalty saturates):
//   PM2.5 75 ug/m3 -> US EPA "Unhealthy for Sensitive Groups" boundary
//   VOC   500      -> Sensirion VOC Index ceiling (full scale)
//   CO2   2200 ppm above 400 baseline -> Harvard COGfx cognitive impact threshold
//
// Returns: { score, label, color, advice, pct } where score is null when
// no pollutants are present (empty-state).
function computeScore({ pm25, voc, co2 }) {
  const pollutants = [
    { value: pm25, divisor: 75,   weight: 40 },
    { value: voc,  divisor: 500,  weight: 25 },
    { value: co2 != null ? co2 - 400 : null, divisor: 2200, weight: 35 },
  ].filter(p => p.value != null);

  if (pollutants.length === 0) {
    return {
      score: null,
      label: 'No data',
      color: 'var(--air-quality-card-no-data-color, #9ca3af)',
      text: 'var(--secondary-text-color)',
      advice: 'Configure PM2.5, VOC, or CO₂ sensors to see a calculated score.',
      pct: 0,
    };
  }

  const totalWeight = pollutants.reduce((s, p) => s + p.weight, 0);
  const totalPenalty = pollutants.reduce((s, p) => {
    const frac = Math.min(1, Math.max(0, p.value / p.divisor));
    return s + frac * (p.weight / totalWeight) * 100;
  }, 0);
  const score = Math.min(100, Math.max(0, Math.round(100 - totalPenalty)));
  const band = SCORE_BANDS.find(b => score >= b.min);

  return {
    score,
    label: band.label,
    color: band.color,
    text: band.text,
    advice: band.advice,
    pct: score / 100,
  };
}

console.info(
  `%c  AIR-QUALITY-CARD  %c  Version ${VERSION}  `,
  'color: white; font-weight: bold; background: #03a9f4',
  'color: #03a9f4; font-weight: bold; background: white'
);

// ============================================================
// Visual UI Editor
// ============================================================
class AirQualityCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = [
        { name: "title", label: "Card Title", helper: "Shown at the top of the card.", selector: { text: {} } },
        { name: "default_expanded", label: "Expanded by Default", helper: "Whether the card opens expanded. Click the title to toggle.", selector: { boolean: {} } },
        { name: "aqi_entity", label: "AQI Sensor (Optional)", helper: "If set, displays this sensor's value with EPA AirNow bands. If empty or unavailable, falls back to a calculated score from PM2.5, VOC, and CO2.", selector: { entity: { domain: "sensor", device_class: "aqi" } } },
        { name: "temp_entity", label: "Temperature Sensor", helper: "Shown next to the headline. Also feeds the optional history graph.", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
        { name: "humid_entity", label: "Humidity Sensor", helper: "Shown next to the headline. Also feeds the optional history graph.", selector: { entity: { domain: "sensor", device_class: "humidity" } } },
        { name: "pm1_entity", label: "PM1.0 Sensor", helper: "Display only - does not contribute to the calculated score.", selector: { entity: { domain: "sensor", device_class: "pm1" } } },
        { name: "pm25_entity", label: "PM2.5 Sensor", helper: "Largest contributor to the calculated score (40% weight).", selector: { entity: { domain: "sensor", device_class: "pm25" } } },
        { name: "pm4_entity", label: "PM4.0 Sensor", helper: "Display only - does not contribute to the calculated score.", selector: { entity: { domain: "sensor" } } },
        { name: "pm10_entity", label: "PM10 Sensor", helper: "Display only - does not contribute to the calculated score.", selector: { entity: { domain: "sensor", device_class: "pm10" } } },
        { name: "voc_entity", label: "VOC Index Sensor", helper: "Sensirion VOC Index (0-500 scale). Other TVOC sensors may produce misleading bands.", selector: { entity: { domain: "sensor", device_class: "volatile_organic_compounds" } } },
        { name: "co2_entity", label: "CO2 Sensor (ppm)", helper: "Contributes to the calculated score (35% weight). Drives 'open a window' advice above 1000 ppm.", selector: { entity: { domain: "sensor", device_class: "carbon_dioxide" } } },
      ];
      this._form.computeLabel = (schema) => schema.label || schema.name;
      this._form.computeHelper = (schema) => schema.helper || "";
      this._form.addEventListener("value-changed", (ev) => {
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: ev.detail.value } }));
      });
      this.shadowRoot.appendChild(this._form);
    }

    this._form.hass = this._hass;
    this._form.data = this._config;
  }
}
if (typeof customElements !== 'undefined') customElements.define("air-quality-card-editor", AirQualityCardEditor);

// ============================================================
// Main Card Element
// ============================================================
class AirQualityCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._graphConfigured = false;
    this._lastStates = {};
  }

  static getConfigElement() { return document.createElement("air-quality-card-editor"); }

  // Translate a dotted-path string key from the STRINGS table, falling
  // back to English when the HA locale doesn't have an entry. e.g.
  // this.t('stats.temp') -> 'TEMP'.
  t(path) {
    const lang = this._hass?.locale?.language || this._hass?.language || 'en';
    const lookup = (table) => path.split('.').reduce((o, k) => o?.[k], table);
    return lookup(STRINGS[lang]) ?? lookup(STRINGS.en) ?? path;
  }

  static getStubConfig() {
    return { title: "Living Room", default_expanded: true, aqi_entity: "", temp_entity: "", humid_entity: "", pm1_entity: "", pm25_entity: "", pm4_entity: "", pm10_entity: "", voc_entity: "", co2_entity: "" };
  }

  setConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid configuration: expected an object');
    }

    // Per-slot allowed entity domains. aqi_entity also accepts the
    // air_quality.* domain since some HA integrations expose AQI there
    // rather than as a sensor.
    const allowedDomains = {
      aqi_entity:    ['sensor.', 'air_quality.'],
      temp_entity:   ['sensor.'],
      humid_entity:  ['sensor.'],
      pm1_entity:    ['sensor.'],
      pm25_entity:   ['sensor.'],
      pm4_entity:    ['sensor.'],
      pm10_entity:   ['sensor.'],
      voc_entity:    ['sensor.'],
      co2_entity:    ['sensor.'],
    };
    for (const [key, prefixes] of Object.entries(allowedDomains)) {
      const value = config[key];
      if (value == null || value === '') continue;
      if (typeof value !== 'string' || !prefixes.some(p => value.startsWith(p))) {
        throw new Error(`${key} must be one of (${prefixes.map(p => p + '*').join(', ')}), got: ${value}`);
      }
    }

    this.config = config;

    // Drop cached state for entities that may have been removed or
    // swapped. Without this, re-adding the same entity later starts
    // with a stale "last" value and the first paint can be skipped.
    this._lastStates = {};

    if (this._expanded === undefined) {
      this._expanded = config.default_expanded !== false;
    }

    if (!this._graphCard) {
      this._graphCard = document.createElement("mini-graph-card");
    }

    const graphEntities = [];
    if (config.temp_entity) graphEntities.push({ entity: config.temp_entity, name: "Temp", color: "#fde68a" });
    if (config.humid_entity) graphEntities.push({ entity: config.humid_entity, name: "Humidity", color: "#a8c0e0", y_axis: "secondary" });

    if (graphEntities.length > 0) {
      // Race whenDefined against a timeout so we degrade gracefully when
      // mini-graph-card isn't installed. The promise would otherwise hang
      // forever, leaving an empty band where the graph should be.
      const ready = customElements.whenDefined("mini-graph-card");
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("mini-graph-card not installed")), 2000)
      );

      Promise.race([ready, timeout]).then(() => {
        try {
          this._graphCard.setConfig({
            type: "custom:mini-graph-card",
            entities: graphEntities,
            hours_to_show: 24,
            points_per_hour: 2,
            line_width: 2,
            animate: true,
            smoothing: true,
            hour24: true,
            height: 60,
            show: { name: false, icon: false, state: false, legend: true, labels: false, fill: "fade" }
          });
        } catch (err) {
          // mini-graph-card is registered but rejected our config (e.g.
          // breaking-change rename, schema mismatch). Tear down the graph
          // section the same way we do on the not-installed timeout.
          throw err;
        }

        this._graphConfigured = true;
        this._graphCard.style.display = "block";

        if (this._hass) {
          this._graphCard.hass = this._hass;
        }
      }).catch((err) => {
        // mini-graph-card isn't installed, OR setConfig threw. Either
        // way: hide the graph section entirely. The rest of the card
        // still works.
        this._graphConfigured = false;
        this._graphCard.style.display = "none";
        if (this.graphSection) this.graphSection.style.display = "none";
        if (err && err.message && !err.message.includes("not installed")) {
          console.warn("[air-quality-card] mini-graph-card setConfig failed:", err);
        } else {
          console.info("[air-quality-card] mini-graph-card not found, temp/humidity history graph disabled. Install via HACS to enable it.");
        }
      });
    } else {
      this._graphCard.style.display = "none";
    }

    if (this._hass) {
      if (!this.topSection) this.renderInit();
      this._renderedOnce = false;
      this.triggerUpdate();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.config) return;

    if (this._graphCard && this._graphConfigured) {
      this._graphCard.hass = hass;
    }

    if (!this.topSection) {
      this.renderInit();
    }

    let needsUpdate = false;
    const trackedEntities = [
      this.config.aqi_entity, this.config.pm1_entity, this.config.pm25_entity,
      this.config.pm10_entity, this.config.voc_entity, this.config.co2_entity,
      this.config.temp_entity, this.config.humid_entity
    ];

    for (const entity of trackedEntities) {
      if (!entity || !hass.states[entity]) continue;
      if (this._lastStates[entity] !== hass.states[entity].state) {
        needsUpdate = true;
        this._lastStates[entity] = hass.states[entity].state;
      }
    }

    if (needsUpdate || !this._renderedOnce) {
      this._renderedOnce = true;
      this.updateData();
    }
  }

  triggerUpdate() {
    if (!this._hass || !this.config) return;

    const trackedEntities = [
      this.config.aqi_entity, this.config.pm1_entity, this.config.pm25_entity,
      this.config.pm10_entity, this.config.voc_entity, this.config.co2_entity,
      this.config.temp_entity, this.config.humid_entity
    ];

    for (const entity of trackedEntities) {
      if (entity && this._hass.states[entity]) {
        this._lastStates[entity] = this._hass.states[entity].state;
      }
    }
    this._renderedOnce = true;
    this.updateData();
  }

  renderInit() {
    const card = document.createElement('ha-card');
    card.style.cssText = `
      padding: 20px;
      color: var(--primary-text-color);
      font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
    `;

    const content = document.createElement('div');

    this.topSection = document.createElement('div');
    this.topSection.style.cursor = 'pointer';
    this.topSection.setAttribute('role', 'button');
    this.topSection.setAttribute('tabindex', '0');
    const toggle = () => {
      this._expanded = !this._expanded;
      this.updateData();
    };
    this.topSection.addEventListener('click', toggle);
    this.topSection.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
    content.appendChild(this.topSection);

    this.graphSection = document.createElement('div');
    this.graphSection.style.cssText = `
      display: block;
      width: 100%;
      --ha-card-background: transparent;
      --ha-card-border-width: 0;
      --ha-card-box-shadow: none;
      margin: 0 -6px 14px -6px;
    `;
    this.graphSection.appendChild(this._graphCard);
    content.appendChild(this.graphSection);

    this.bottomSection = document.createElement('div');
    content.appendChild(this.bottomSection);

    card.appendChild(content);
    this.shadowRoot.appendChild(card);
  }

  safeNum(entityId) {
    if (!entityId || !this._hass.states[entityId]) return null;
    const state = this._hass.states[entityId].state;
    if (state === 'unavailable' || state === 'unknown') return null;
    const num = parseFloat(state);
    return isNaN(num) ? null : num;
  }

  formatNum(num, decimals = 1) {
    return num == null ? '--' : num.toFixed(decimals);
  }

  getUnit(entityId, defaultUnit) {
    if (!entityId || !this._hass.states[entityId]) return defaultUnit;
    return this._hass.states[entityId].attributes?.unit_of_measurement || defaultUnit;
  }

  _renderTile(name, value, unit, st) {
    return `
      <div style="padding:0 6px;min-width:0;overflow:hidden;${value == null ? 'opacity:0.5;' : ''}" role="group" aria-label="${name}: ${value == null ? 'no data' : value.toLocaleString() + ' ' + unit}, ${st.label}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:4px;" aria-hidden="true">
          <span style="font-size:11px;color:var(--secondary-text-color);font-weight:500;">${name}</span>
          <span style="font-size:9px;color:${st.text};">${st.label}</span>
        </div>
        <div style="display:flex;align-items:baseline;gap:4px;" aria-hidden="true">
          <span style="font-size:22px;font-weight:400;line-height:1;">${value == null ? '--' : value.toLocaleString()}</span>
          <span style="font-size:10px;color:var(--secondary-text-color);">${value == null ? '' : unit}</span>
        </div>
        <div style="height:3px;background:var(--divider-color, #444);border-radius:2px;overflow:hidden;margin-top:8px;" role="progressbar" aria-valuenow="${Math.round(st.pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="${name} level">
          <div style="height:100%;width:${st.pct}%;background:${st.color};"></div>
        </div>
      </div>
    `;
  }

  calcThreshold(value, good, mod, high) {
    return calcThreshold(value, good, mod, high);
  }

  updateData() {
    // Determine if we have a valid AQI sensor. Some integrations report
    // textual states like "Good" - those should fall back to score mode
    // rather than display NaN under the AQI sensor's friendly name.
    const aqiStateObj = this.config.aqi_entity ? this._hass.states[this.config.aqi_entity] : null;
    const aqi = aqiStateObj ? parseFloat(aqiStateObj.state) : NaN;
    const hasAqi = aqiStateObj && !isNaN(aqi);

    // Fetch the friendly name to display above the score
    const topName = hasAqi ? (aqiStateObj.attributes.friendly_name || this.t('topName.aqi')) : this.t('topName.score');

    const pm1 = this.safeNum(this.config.pm1_entity);
    const pm25 = this.safeNum(this.config.pm25_entity);
    const pm4 = this.safeNum(this.config.pm4_entity);
    const pm10 = this.safeNum(this.config.pm10_entity);
    const voc = this.safeNum(this.config.voc_entity);
    const co2 = this.safeNum(this.config.co2_entity);
    const temp = this.safeNum(this.config.temp_entity);
    const humid = this.safeNum(this.config.humid_entity);

    const tempUnit = this.getUnit(this.config.temp_entity, '°C');
    const humidUnit = this.getUnit(this.config.humid_entity, '%');
    const pm1Unit = this.getUnit(this.config.pm1_entity, 'µg/m³');
    const pm25Unit = this.getUnit(this.config.pm25_entity, 'µg/m³');
    const pm4Unit = this.getUnit(this.config.pm4_entity, 'µg/m³');
    const pm10Unit = this.getUnit(this.config.pm10_entity, 'µg/m³');
    const vocUnit = this.getUnit(this.config.voc_entity, 'index');
    const co2Unit = this.getUnit(this.config.co2_entity, 'ppm');

    let displayValue, displayLabel, advice, ringColor, textColor, dashOffset, ringTopText;
    const radius = 42;
    const circ = 2 * Math.PI * radius;

    if (hasAqi) {
      // --- MODE: OFFICIAL AQI ---
      displayValue = Math.round(aqi);
      ringTopText = this.t('ring.aqi'); // Gauge text
      const band = AQI_BANDS.find(b => aqi <= b.max);
      ringColor = band.color; textColor = band.text; displayLabel = band.label; advice = band.advice;

      const aqiPct = Math.min(Math.max(aqi, 0) / 500, 1);
      dashOffset = circ - (aqiPct * circ);

    } else {
      // --- MODE: CUSTOM SCORE FALLBACK ---
      const result = computeScore({ pm25, voc, co2 });
      displayValue = result.score == null ? '--' : result.score;
      ringTopText = this.t('ring.score');
      ringColor = result.color;
      textColor = result.text;
      displayLabel = result.label;
      advice = result.advice;
      dashOffset = circ - (result.pct * circ);
    }

    // Specific pollutant overrides for advice, but only when the headline
    // state is benign. Otherwise an AQI 450 reading would have its
    // "Emergency health warning" replaced with the meeker "open a window".
    const headlineIsBenign = displayLabel === 'Good' || displayLabel === 'Moderate';
    if (headlineIsBenign) {
      if (voc > 200) advice = this.t('advice.vocHigh');
      if (co2 > 1000) advice = this.t('advice.co2High');
      if (co2 > 1500) advice = this.t('advice.co2VeryHigh');
    }

    // Compose the chip's faint background and border from ringColor via
    // color-mix so user theme overrides on the *-color custom properties
    // automatically tint the badge too. Falls back to transparent on
    // browsers without color-mix support (Safari < 16.2, etc).
    const chipBg = `color-mix(in srgb, ${ringColor} 12%, transparent)`;
    const chipBorder = `color-mix(in srgb, ${ringColor} 35%, transparent)`;

    const T = POLLUTANT_THRESHOLDS;
    const pm1S  = this.calcThreshold(pm1,  T.pm1.good,  T.pm1.mod,  T.pm1.high);
    const pm25S = this.calcThreshold(pm25, T.pm25.good, T.pm25.mod, T.pm25.high);
    const pm4S  = this.calcThreshold(pm4,  T.pm4.good,  T.pm4.mod,  T.pm4.high);
    const pm10S = this.calcThreshold(pm10, T.pm10.good, T.pm10.mod, T.pm10.high);
    const vocS  = this.calcThreshold(voc,  T.voc.good,  T.voc.mod,  T.voc.high);
    const co2S  = this.calcThreshold(co2,  T.co2.good,  T.co2.mod,  T.co2.high);


    const headlineUnit = hasAqi ? (aqiStateObj.attributes.unit_of_measurement || 'AQI') : '/ 100';
    const headlineAriaLabel = `${this.config.title || 'Air quality'}: ${displayLabel}, ${displayValue} ${headlineUnit}`.trim();

    if (!this._expanded) {
      this.graphSection.style.display = 'none';
      this.bottomSection.style.display = 'none';
      this.topSection.setAttribute('aria-expanded', 'false');
      this.topSection.setAttribute('aria-label', `${headlineAriaLabel}. Activate to expand.`);
      this.topSection.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:12px;">
            <ha-icon icon="mdi:chevron-down" style="color:var(--secondary-text-color); transition: transform 0.3s;" aria-hidden="true"></ha-icon>
            <div>
              <div style="font-size:15px;font-weight:500;">${this.config.title || 'Living Room'}</div>
              <div style="font-size:11px;color:var(--secondary-text-color);margin-top:2px;">${this.t('subtitle')}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;" role="group" aria-label="${headlineAriaLabel}">
            <div style="display:flex;align-items:baseline;gap:4px;">
              <span style="font-size:18px;font-weight:400;color:${textColor};">${displayValue}</span>
              <span style="font-size:10px;color:var(--secondary-text-color);">${displayValue === '--' ? '' : (hasAqi ? (aqiStateObj.attributes.unit_of_measurement || '') : '/ 100')}</span>
            </div>
            <div style="background:${chipBg};border:1px solid ${chipBorder};border-radius:999px;padding:5px 12px;font-size:11px;color:${textColor};display:flex;align-items:center;gap:6px;">
              <span style="width:6px;height:6px;background:${ringColor};border-radius:50%;" aria-hidden="true"></span>${displayLabel}
            </div>
          </div>
        </div>
      `;
      return;
    }

    this.topSection.setAttribute('aria-expanded', 'true');
    this.topSection.setAttribute('aria-label', `${headlineAriaLabel}. Activate to collapse.`);

    this.graphSection.style.display = (this._graphConfigured ? 'block' : 'none');
    this.bottomSection.style.display = 'block';

    this.topSection.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <ha-icon icon="mdi:chevron-up" style="color:var(--secondary-text-color); transition: transform 0.3s;" aria-hidden="true"></ha-icon>
          <div>
            <div style="font-size:15px;font-weight:500;">${this.config.title || 'Living Room'}</div>
            <div style="font-size:11px;color:var(--secondary-text-color);margin-top:2px;">${this.t('subtitle')}</div>
          </div>
        </div>
        <!-- Indicator hidden when expanded as requested -->
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="flex-grow: 1; overflow: hidden; padding-right: 14px;">
          <div style="font-size:12px;color:var(--secondary-text-color);margin-bottom:4px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${topName}">${topName}</div>
          
          <div style="display:flex;align-items:baseline;gap:6px;" role="group" aria-label="${headlineAriaLabel}">
            <span style="font-size:clamp(36px, 8vw, 54px);font-weight:400;color:${textColor};line-height:1;">${displayValue}</span>
            <span style="font-size:14px;color:var(--secondary-text-color);">${hasAqi || displayValue === '--' ? '' : '/ 100'}</span>
          </div>
          <div style="font-size:12px;color:var(--secondary-text-color);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${advice}</div>

          <div style="display:flex;gap:14px;margin-top:14px;">
            <div style="${temp == null ? 'opacity:0.5;' : ''}" aria-label="Temperature: ${this.formatNum(temp, 1)} ${tempUnit}">
              <div style="display:flex;align-items:baseline;gap:4px;">
                <span style="font-size:24px;font-weight:400;">${this.formatNum(temp, 1)}</span>
                <span style="font-size:11px;color:var(--secondary-text-color);">${temp == null ? '' : tempUnit}</span>
              </div>
              <div style="font-size:10px;color:var(--secondary-text-color);margin-top:2px;" aria-hidden="true">${this.t('stats.temp')}</div>
            </div>
            <div style="width:1px;background:var(--divider-color, #444);" aria-hidden="true"></div>
            <div style="${humid == null ? 'opacity:0.5;' : ''}" aria-label="Humidity: ${this.formatNum(humid, 0)} ${humidUnit}">
              <div style="display:flex;align-items:baseline;gap:4px;">
                <span style="font-size:24px;font-weight:400;">${this.formatNum(humid, 0)}</span>
                <span style="font-size:11px;color:var(--secondary-text-color);">${humid == null ? '' : humidUnit}</span>
              </div>
              <div style="font-size:10px;color:var(--secondary-text-color);margin-top:2px;" aria-hidden="true">${this.t('stats.humidity')}</div>
            </div>
          </div>
        </div>

        <div style="position:relative;width:100px;height:100px;flex-shrink:0;" role="meter" aria-valuenow="${hasAqi ? displayValue : displayValue}" aria-valuemin="0" aria-valuemax="${hasAqi ? 500 : 100}" aria-label="${ringTopText}: ${displayValue}, ${displayLabel}">
          <svg viewBox="0 0 100 100" style="transform:rotate(-90deg);width:100%;height:100%;" aria-hidden="true">
            <title>${ringTopText} ${displayValue}</title>
            <circle cx="50" cy="50" r="${radius}" fill="none" stroke="var(--divider-color, #444)" stroke-width="8"/>
            <circle cx="50" cy="50" r="${radius}" fill="none" stroke="${ringColor}" stroke-width="8" stroke-dasharray="${circ}" stroke-dashoffset="${dashOffset}" stroke-linecap="round" style="transition: stroke-dashoffset 1s ease-out;"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;" aria-hidden="true">
            <div style="font-size:11px;color:var(--secondary-text-color);">${ringTopText}</div>
            <div style="font-size:13px;color:${textColor};font-weight:500;text-align:center;line-height:1.1;margin-top:2px;max-width:80px;">${hasAqi || displayValue === '--' ? displayLabel : displayValue + '%'}</div>
          </div>
        </div>
      </div>
    `;

    this.bottomSection.innerHTML = `
      <div style="padding-top:14px;border-top:1px solid var(--divider-color, #444);">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px;">
          ${this._renderTile('PM1.0', pm1, pm1Unit, pm1S)}
          ${this._renderTile('PM2.5', pm25, pm25Unit, pm25S)}
          ${this._renderTile('PM4.0', pm4, pm4Unit, pm4S)}
          ${this._renderTile('PM10', pm10, pm10Unit, pm10S)}
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
          ${this._renderTile('VOC', voc, vocUnit, vocS)}
          ${this._renderTile('CO₂', co2, co2Unit, co2S)}
        </div>
      </div>
    `;
  }

  getCardSize() { return 5; }
}

if (typeof customElements !== 'undefined') {
  customElements.define('air-quality-card', AirQualityCard);
}

if (typeof window !== 'undefined') {
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "air-quality-card",
    name: "Air Quality Card",
    preview: true,
    description: "A custom card displaying air quality metrics and an overall score."
  });
}

// Exports for unit tests (test/score.test.mjs). Browsers ignore these.
export { computeScore, calcThreshold, AQI_BANDS, SCORE_BANDS, POLLUTANT_THRESHOLDS };