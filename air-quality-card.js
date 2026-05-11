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
const AQI_BANDS = [
  { max: 50,       color: '#86efac', label: 'Good',           advice: 'Air quality is satisfactory.' },
  { max: 100,      color: '#fde68a', label: 'Moderate',       advice: 'Acceptable air quality.' },
  { max: 150,      color: '#fdba74', label: 'Unhealthy (SG)', advice: 'Sensitive groups may be affected.' },
  { max: 200,      color: '#fca5a5', label: 'Unhealthy',      advice: 'Everyone may experience health effects.' },
  { max: 300,      color: '#d8b4fe', label: 'V. Unhealthy',   advice: 'Health alert: risk is increased.' },
  { max: Infinity, color: '#fda4af', label: 'Hazardous',      advice: 'Emergency health warning.' },
];

// Internal score-mode bands (lower is worse, 0-100 scale).
const SCORE_BANDS = [
  { min: 80,        color: '#86efac', label: 'Good',     advice: 'Air quality is good' },
  { min: 60,        color: '#fde68a', label: 'Moderate', advice: 'Air quality is moderate' },
  { min: 40,        color: '#fdba74', label: 'Poor',     advice: 'Consider ventilating' },
  { min: -Infinity, color: '#fca5a5', label: 'Bad',      advice: 'Ventilate now' },
];

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
        { name: "title", label: "Card Title", selector: { text: {} } },
        { name: "default_expanded", label: "Expanded by Default", selector: { boolean: {} } },
        { name: "aqi_entity", label: "AQI Sensor (Optional)", selector: { entity: { domain: "sensor", device_class: "aqi" } } },
        { name: "temp_entity", label: "Temperature Sensor", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
        { name: "humid_entity", label: "Humidity Sensor", selector: { entity: { domain: "sensor", device_class: "humidity" } } },
        { name: "pm1_entity", label: "PM1.0 Sensor", selector: { entity: { domain: "sensor", device_class: "pm1" } } },
        { name: "pm25_entity", label: "PM2.5 Sensor", selector: { entity: { domain: "sensor", device_class: "pm25" } } },
        { name: "pm4_entity", label: "PM4.0 Sensor", selector: { entity: { domain: "sensor" } } },
        { name: "pm10_entity", label: "PM10 Sensor", selector: { entity: { domain: "sensor", device_class: "pm10" } } },
        { name: "voc_entity", label: "VOC Index Sensor", selector: { entity: { domain: "sensor", device_class: "volatile_organic_compounds" } } },
        { name: "co2_entity", label: "CO2 Sensor (ppm)", selector: { entity: { domain: "sensor", device_class: "carbon_dioxide" } } },
      ];
      this._form.computeLabel = (schema) => schema.label || schema.name;
      this._form.addEventListener("value-changed", (ev) => {
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: ev.detail.value } }));
      });
      this.shadowRoot.appendChild(this._form);
    }

    this._form.hass = this._hass;
    this._form.data = this._config;
  }
}
customElements.define("air-quality-card-editor", AirQualityCardEditor);

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

  static getStubConfig() {
    return { title: "Living Room", default_expanded: true, aqi_entity: "", temp_entity: "", humid_entity: "", pm1_entity: "", pm25_entity: "", pm4_entity: "", pm10_entity: "", voc_entity: "", co2_entity: "" };
  }

  setConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid configuration: expected an object');
    }

    const entityKeys = [
      'aqi_entity', 'temp_entity', 'humid_entity',
      'pm1_entity', 'pm25_entity', 'pm4_entity', 'pm10_entity',
      'voc_entity', 'co2_entity'
    ];
    for (const key of entityKeys) {
      const value = config[key];
      if (value == null || value === '') continue;
      if (typeof value !== 'string' || !value.startsWith('sensor.')) {
        throw new Error(`${key} must be a sensor.* entity, got: ${value}`);
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

        this._graphConfigured = true;
        this._graphCard.style.display = "block";

        if (this._hass) {
          this._graphCard.hass = this._hass;
        }
      }).catch(() => {
        // mini-graph-card isn't installed - hide the graph section
        // entirely. The rest of the card still works.
        this._graphConfigured = false;
        this._graphCard.style.display = "none";
        if (this.graphSection) this.graphSection.style.display = "none";
        console.info("[air-quality-card] mini-graph-card not found, temp/humidity history graph disabled. Install via HACS to enable it.");
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

  calcThreshold(value, good, mod, high) {
    if (value == null) return { label: '--', color: 'var(--secondary-text-color)', pct: 0 };
    if (value <= good) return { label: 'GOOD', color: '#86efac', pct: Math.min(100, (value / high) * 100) };
    if (value <= mod) return { label: 'MOD', color: '#fde68a', pct: Math.min(100, (value / high) * 100) };
    if (value <= high) return { label: 'HIGH', color: '#fdba74', pct: Math.min(100, (value / high) * 100) };
    return { label: 'V.HIGH', color: '#fca5a5', pct: 100 };
  }

  updateData() {
    // Determine if we have a valid AQI sensor
    const aqiStateObj = this.config.aqi_entity ? this._hass.states[this.config.aqi_entity] : null;
    const hasAqi = aqiStateObj && aqiStateObj.state !== 'unavailable' && aqiStateObj.state !== 'unknown';
    const aqi = hasAqi ? parseFloat(aqiStateObj.state) : 0;

    // Fetch the friendly name to display above the score
    const topName = hasAqi ? (aqiStateObj.attributes.friendly_name || 'AQI Sensor') : 'Calculated Score';

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

    let displayValue, displayLabel, advice, ringColor, dashOffset, ringTopText;
    const radius = 42;
    const circ = 2 * Math.PI * radius;

    if (hasAqi && !isNaN(aqi)) {
      // --- MODE: OFFICIAL AQI ---
      displayValue = Math.round(aqi);
      ringTopText = 'AQI'; // Gauge text
      const band = AQI_BANDS.find(b => aqi <= b.max);
      ringColor = band.color; displayLabel = band.label; advice = band.advice;

      const aqiPct = Math.min(Math.max(aqi, 0) / 500, 1);
      dashOffset = circ - (aqiPct * circ);

    } else {
      // --- MODE: CUSTOM SCORE FALLBACK ---
      // Each pollutant contributes a penalty fraction in [0, 1] times its
      // weight. Missing pollutants are dropped and the remaining weights
      // renormalize to 100, so a partial sensor set still spans 0-100
      // instead of getting an artificial ceiling.
      const pollutants = [
        { value: pm25, divisor: 35,   weight: 40 },
        { value: voc,  divisor: 300,  weight: 25 },
        { value: co2 != null ? co2 - 400 : null, divisor: 1600, weight: 35 },
      ].filter(p => p.value != null);

      if (pollutants.length === 0) {
        // No pollutant data at all - render an honest empty state.
        displayValue = '--';
        ringTopText = 'SCORE';
        ringColor = '#9ca3af';
        displayLabel = 'No data';
        advice = 'Configure pollutant sensors to see air quality.';
        dashOffset = circ;
      } else {
        const totalWeight = pollutants.reduce((s, p) => s + p.weight, 0);
        const totalPenalty = pollutants.reduce((s, p) => {
          const frac = Math.min(1, Math.max(0, p.value / p.divisor));
          return s + frac * (p.weight / totalWeight) * 100;
        }, 0);
        const score = Math.min(100, Math.max(0, Math.round(100 - totalPenalty)));

        displayValue = score;
        ringTopText = 'SCORE'; // Gauge text
        const band = SCORE_BANDS.find(b => score >= b.min);
        ringColor = band.color; displayLabel = band.label; advice = band.advice;

        const scorePct = score / 100;
        dashOffset = circ - (scorePct * circ);
      }
    }

    // Specific pollutant overrides for advice, but only when the headline
    // state is benign. Otherwise an AQI 450 reading would have its
    // "Emergency health warning" replaced with the meeker "open a window".
    const headlineIsBenign = displayLabel === 'Good' || displayLabel === 'Moderate';
    if (headlineIsBenign) {
      if (voc > 200) advice = 'VOCs detected';
      if (co2 > 1000) advice = 'CO2 high - open a window';
      if (co2 > 1500) advice = 'CO2 very high - ventilate';
    }

    const r = parseInt(ringColor.slice(1, 3), 16), g = parseInt(ringColor.slice(3, 5), 16), b = parseInt(ringColor.slice(5, 7), 16);

    const T = POLLUTANT_THRESHOLDS;
    const pm1S  = this.calcThreshold(pm1,  T.pm1.good,  T.pm1.mod,  T.pm1.high);
    const pm25S = this.calcThreshold(pm25, T.pm25.good, T.pm25.mod, T.pm25.high);
    const pm4S  = this.calcThreshold(pm4,  T.pm4.good,  T.pm4.mod,  T.pm4.high);
    const pm10S = this.calcThreshold(pm10, T.pm10.good, T.pm10.mod, T.pm10.high);
    const vocS  = this.calcThreshold(voc,  T.voc.good,  T.voc.mod,  T.voc.high);
    const co2S  = this.calcThreshold(co2,  T.co2.good,  T.co2.mod,  T.co2.high);

    const renderTile = (name, value, unit, st) => `
      <div style="padding:0 6px;min-width:0;overflow:hidden;${value == null ? 'opacity:0.5;' : ''}" role="group" aria-label="${name}: ${value == null ? 'no data' : value.toLocaleString() + ' ' + unit}, ${st.label}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:4px;" aria-hidden="true">
          <span style="font-size:11px;color:var(--secondary-text-color);font-weight:500;">${name}</span>
          <span style="font-size:9px;color:${st.color};">${st.label}</span>
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
              <div style="font-size:11px;color:var(--secondary-text-color);margin-top:2px;">Climate · Air Quality</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;" role="status" aria-live="polite">
            <div style="display:flex;align-items:baseline;gap:4px;">
              <span style="font-size:18px;font-weight:400;color:${ringColor};">${displayValue}</span>
              <span style="font-size:10px;color:var(--secondary-text-color);">${displayValue === '--' ? '' : (hasAqi ? (aqiStateObj.attributes.unit_of_measurement || '') : '/ 100')}</span>
            </div>
            <div style="background:rgba(${r},${g},${b},0.12);border:1px solid rgba(${r},${g},${b},0.35);border-radius:999px;padding:5px 12px;font-size:11px;color:${ringColor};display:flex;align-items:center;gap:6px;">
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
            <div style="font-size:11px;color:var(--secondary-text-color);margin-top:2px;">Climate · Air Quality</div>
          </div>
        </div>
        <!-- Indicator hidden when expanded as requested -->
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="flex-grow: 1; overflow: hidden; padding-right: 14px;">
          <div style="font-size:12px;color:var(--secondary-text-color);margin-bottom:4px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${topName}">${topName}</div>
          
          <div style="display:flex;align-items:baseline;gap:6px;" role="status" aria-live="polite" aria-label="${headlineAriaLabel}">
            <span style="font-size:54px;font-weight:400;color:${ringColor};line-height:1;">${displayValue}</span>
            <span style="font-size:14px;color:var(--secondary-text-color);">${hasAqi || displayValue === '--' ? '' : '/ 100'}</span>
          </div>
          <div style="font-size:12px;color:var(--secondary-text-color);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${advice}</div>

          <div style="display:flex;gap:14px;margin-top:14px;">
            <div style="${temp == null ? 'opacity:0.5;' : ''}" aria-label="Temperature: ${this.formatNum(temp, 1)} ${tempUnit}">
              <div style="display:flex;align-items:baseline;gap:4px;">
                <span style="font-size:24px;font-weight:400;">${this.formatNum(temp, 1)}</span>
                <span style="font-size:11px;color:var(--secondary-text-color);">${temp == null ? '' : tempUnit}</span>
              </div>
              <div style="font-size:10px;color:var(--secondary-text-color);margin-top:2px;" aria-hidden="true">TEMP</div>
            </div>
            <div style="width:1px;background:var(--divider-color, #444);" aria-hidden="true"></div>
            <div style="${humid == null ? 'opacity:0.5;' : ''}" aria-label="Humidity: ${this.formatNum(humid, 0)} ${humidUnit}">
              <div style="display:flex;align-items:baseline;gap:4px;">
                <span style="font-size:24px;font-weight:400;">${this.formatNum(humid, 0)}</span>
                <span style="font-size:11px;color:var(--secondary-text-color);">${humid == null ? '' : humidUnit}</span>
              </div>
              <div style="font-size:10px;color:var(--secondary-text-color);margin-top:2px;" aria-hidden="true">HUMIDITY</div>
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
            <div style="font-size:13px;color:${ringColor};font-weight:500;text-align:center;line-height:1.1;margin-top:2px;max-width:80px;">${hasAqi || displayValue === '--' ? displayLabel : displayValue + '%'}</div>
          </div>
        </div>
      </div>
    `;

    this.bottomSection.innerHTML = `
      <div style="padding-top:14px;border-top:1px solid var(--divider-color, #444);">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px;">
          ${renderTile('PM1.0', pm1, pm1Unit, pm1S)}
          ${renderTile('PM2.5', pm25, pm25Unit, pm25S)}
          ${renderTile('PM4.0', pm4, pm4Unit, pm4S)}
          ${renderTile('PM10', pm10, pm10Unit, pm10S)}
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
          ${renderTile('VOC', voc, vocUnit, vocS)}
          ${renderTile('CO₂', co2, co2Unit, co2S)}
        </div>
      </div>
    `;
  }

  getCardSize() { return 5; }
}

customElements.define('air-quality-card', AirQualityCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "air-quality-card",
  name: "Air Quality Card",
  preview: true,
  description: "A custom card displaying air quality metrics and an overall score."
});