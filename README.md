# Air Quality Card

A Home Assistant custom card for displaying air quality data.

## Requirements

This card embeds [`mini-graph-card`](https://github.com/kalkih/mini-graph-card) for the temperature/humidity history graph. Install it from HACS first if you want the graph to render. The rest of the card works without it.

## Installation

### HACS (Recommended)

1. Open HACS.
2. Click on "Frontend".
3. Click on the three dots in the top right corner and select "Custom repositories".
4. Add `https://github.com/firstof9/ha-air-quality-card` with category "Lovelace".
5. Search for "Air Quality Card" and click "Download".

### Manual

1. Download `air-quality-card.js` from the latest release.
2. Copy it to your `config/www/` directory.
3. Add the following to your `configuration.yaml` or through the UI:
   ```yaml
   resources:
     - url: /local/air-quality-card.js
       type: module
   ```

## Usage

All entity slots are optional, configure the ones you have.

```yaml
type: custom:air-quality-card
title: Living Room
default_expanded: true
aqi_entity: sensor.living_room_aqi          # optional - if set, takes priority over the calculated score
temp_entity: sensor.living_room_temperature
humid_entity: sensor.living_room_humidity
pm1_entity: sensor.living_room_pm1
pm25_entity: sensor.living_room_pm25
pm4_entity: sensor.living_room_pm4
pm10_entity: sensor.living_room_pm10
voc_entity: sensor.living_room_voc_index
co2_entity: sensor.living_room_co2
```

If `aqi_entity` is not provided (or is `unavailable`), the card computes a 0-100 score from PM2.5, VOC, and CO2.
