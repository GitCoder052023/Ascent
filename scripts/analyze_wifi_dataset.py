#!/usr/bin/env python3
import csv
import html
import json
import math
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


DATASET = Path("/Users/hamdan/WifiClassifier/wifi-floor-dataset-2026-08-27T15-56-39.839Z.csv")
OUTPUT_DIR = Path("/Users/hamdan/WifiLogger/analysis_results/wifi-floor-dataset-2026-08-27T15-56-39")


def parse_timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def pct(values, percentage):
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * (percentage / 100)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return ordered[int(rank)]
    return ordered[low] * (high - rank) + ordered[high] * (rank - low)


def fmt(value, digits=2):
    if value is None:
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def read_rows(path):
    with path.open(newline="") as file:
        rows = list(csv.DictReader(file))
    for row in rows:
        row["timestamp_dt"] = parse_timestamp(row["timestamp"])
        row["signalStrength"] = int(row["signalStrength"])
        row["frequency"] = int(row["frequency"])
    rows.sort(key=lambda row: row["timestamp_dt"])
    return rows


def grouped(rows, key):
    result = defaultdict(list)
    for row in rows:
        result[row[key]].append(row)
    return dict(result)


def floor_summary(rows):
    summaries = []
    for floor, floor_rows in sorted(grouped(rows, "floor").items()):
        signals = [row["signalStrength"] for row in floor_rows]
        times = [row["timestamp_dt"] for row in floor_rows]
        summaries.append(
            {
                "floor": floor,
                "count": len(floor_rows),
                "mean_dBm": statistics.mean(signals),
                "median_dBm": statistics.median(signals),
                "std_dBm": statistics.stdev(signals) if len(signals) > 1 else 0.0,
                "min_dBm": min(signals),
                "q1_dBm": pct(signals, 25),
                "q3_dBm": pct(signals, 75),
                "max_dBm": max(signals),
                "first_timestamp_utc": min(times).isoformat(),
                "last_timestamp_utc": max(times).isoformat(),
                "ssid_count": len(set(row["ssid"] for row in floor_rows)),
                "bssid_count": len(set(row["bssid"] for row in floor_rows)),
            }
        )
    return summaries


def overall_summary(rows):
    signals = [row["signalStrength"] for row in rows]
    timestamps = [row["timestamp_dt"] for row in rows]
    intervals = [
        (rows[index]["timestamp_dt"] - rows[index - 1]["timestamp_dt"]).total_seconds()
        for index in range(1, len(rows))
    ]
    return {
        "dataset": str(DATASET),
        "row_count": len(rows),
        "floor_counts": dict(Counter(row["floor"] for row in rows)),
        "ssid_counts": dict(Counter(row["ssid"] for row in rows)),
        "bssid_counts": dict(Counter(row["bssid"] for row in rows)),
        "frequency_counts": dict(Counter(row["frequency"] for row in rows)),
        "connection_type_counts": dict(Counter(row["connectionType"] for row in rows)),
        "platform_counts": dict(Counter(row["platform"] for row in rows)),
        "device_model_counts": dict(Counter(row["deviceModel"] for row in rows)),
        "signal_min_dBm": min(signals),
        "signal_max_dBm": max(signals),
        "signal_mean_dBm": statistics.mean(signals),
        "capture_start_utc": min(timestamps).isoformat(),
        "capture_end_utc": max(timestamps).isoformat(),
        "capture_duration_minutes": (max(timestamps) - min(timestamps)).total_seconds() / 60,
        "median_sampling_interval_seconds": statistics.median(intervals) if intervals else None,
        "mean_sampling_interval_seconds": statistics.mean(intervals) if intervals else None,
    }


def best_threshold(rows):
    values = sorted(set(row["signalStrength"] for row in rows))
    candidates = [values[0] - 0.5] + [(values[i] + values[i + 1]) / 2 for i in range(len(values) - 1)] + [values[-1] + 0.5]
    floors = sorted(set(row["floor"] for row in rows))
    best = None
    for positive_floor in floors:
        other_floor = [floor for floor in floors if floor != positive_floor][0]
        for threshold in candidates:
            for direction in ("lte", "gte"):
                predictions = []
                for row in rows:
                    is_positive = row["signalStrength"] <= threshold if direction == "lte" else row["signalStrength"] >= threshold
                    predictions.append(positive_floor if is_positive else other_floor)
                correct = sum(pred == row["floor"] for pred, row in zip(predictions, rows))
                accuracy = correct / len(rows)
                record = {
                    "threshold_dBm": threshold,
                    "positive_floor": positive_floor,
                    "other_floor": other_floor,
                    "direction": direction,
                    "accuracy": accuracy,
                    "predictions": predictions,
                }
                if best is None or accuracy > best["accuracy"]:
                    best = record
    labels = sorted(set(row["floor"] for row in rows))
    confusion = {actual: {predicted: 0 for predicted in labels} for actual in labels}
    for prediction, row in zip(best["predictions"], rows):
        confusion[row["floor"]][prediction] += 1
    per_floor = {}
    for label in labels:
        total = sum(confusion[label].values())
        per_floor[label] = {
            "correct": confusion[label][label],
            "total": total,
            "recall": confusion[label][label] / total if total else 0,
        }
    return {
        "rule": f"Predict {best['positive_floor']} when RSSI {'<=' if best['direction'] == 'lte' else '>='} {best['threshold_dBm']:.1f} dBm; otherwise predict {best['other_floor']}.",
        "threshold_dBm": best["threshold_dBm"],
        "accuracy": best["accuracy"],
        "confusion_matrix": confusion,
        "per_floor": per_floor,
    }


def write_csv(path, rows, fieldnames):
    with path.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fieldnames})


def linear_scale(domain_min, domain_max, range_min, range_max):
    if domain_min == domain_max:
        return lambda _: (range_min + range_max) / 2
    return lambda value: range_min + ((value - domain_min) / (domain_max - domain_min)) * (range_max - range_min)


def svg_shell(width, height, title, content):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title)}">
<style>
text {{ font-family: Arial, sans-serif; fill: #1f2937; font-size: 12px; }}
.title {{ font-size: 18px; font-weight: 700; }}
.axis {{ stroke: #6b7280; stroke-width: 1; }}
.grid {{ stroke: #e5e7eb; stroke-width: 1; }}
.floor1 {{ fill: #2563eb; stroke: #2563eb; }}
.floor2 {{ fill: #dc2626; stroke: #dc2626; }}
.muted {{ fill: #6b7280; }}
</style>
<rect width="{width}" height="{height}" fill="#ffffff"/>
<text class="title" x="24" y="32">{html.escape(title)}</text>
{content}
</svg>
"""


def histogram_svg(rows, threshold, path):
    width, height = 900, 520
    left, right, top, bottom = 70, 32, 64, 72
    values = [row["signalStrength"] for row in rows]
    bin_min = math.floor(min(values) / 2) * 2
    bin_max = math.ceil(max(values) / 2) * 2
    bins = list(range(bin_min, bin_max + 2, 2))
    floors = sorted(set(row["floor"] for row in rows))
    counts = {floor: [0 for _ in bins[:-1]] for floor in floors}
    for row in rows:
        idx = min(len(bins) - 2, max(0, int((row["signalStrength"] - bin_min) // 2)))
        counts[row["floor"]][idx] += 1
    max_count = max(sum(counts[floor][i] for floor in floors) for i in range(len(bins) - 1))
    x = linear_scale(bin_min, bin_max, left, width - right)
    y = linear_scale(0, max_count, height - bottom, top)
    parts = []
    for tick in range(bin_min, bin_max + 1, 5):
        parts.append(f'<line class="grid" x1="{x(tick):.1f}" y1="{top}" x2="{x(tick):.1f}" y2="{height-bottom}"/>')
        parts.append(f'<text x="{x(tick):.1f}" y="{height-bottom+24}" text-anchor="middle">{tick}</text>')
    for tick in range(0, max_count + 1, max(1, math.ceil(max_count / 5))):
        parts.append(f'<line class="grid" x1="{left}" y1="{y(tick):.1f}" x2="{width-right}" y2="{y(tick):.1f}"/>')
        parts.append(f'<text x="{left-10}" y="{y(tick)+4:.1f}" text-anchor="end">{tick}</text>')
    bar_gap = 4
    for i in range(len(bins) - 1):
        x0 = x(bins[i]) + bar_gap / 2
        x1 = x(bins[i + 1]) - bar_gap / 2
        baseline = height - bottom
        for floor in floors:
            count = counts[floor][i]
            if count == 0:
                continue
            y0 = y(count)
            klass = "floor1" if floor == "FLOOR_1" else "floor2"
            parts.append(f'<rect class="{klass}" opacity="0.78" x="{x0:.1f}" y="{y0:.1f}" width="{max(1, x1-x0):.1f}" height="{baseline-y0:.1f}"/>')
            baseline = y0
    parts.append(f'<line class="axis" x1="{left}" y1="{height-bottom}" x2="{width-right}" y2="{height-bottom}"/>')
    parts.append(f'<line class="axis" x1="{left}" y1="{top}" x2="{left}" y2="{height-bottom}"/>')
    parts.append(f'<line stroke="#111827" stroke-dasharray="6 5" x1="{x(threshold):.1f}" y1="{top}" x2="{x(threshold):.1f}" y2="{height-bottom}"/>')
    parts.append(f'<text x="{x(threshold)+6:.1f}" y="{top+18}" class="muted">best split {threshold:.1f} dBm</text>')
    parts.append(f'<text x="{width/2}" y="{height-24}" text-anchor="middle">Signal strength (dBm)</text>')
    parts.append(f'<text transform="translate(20 {height/2}) rotate(-90)" text-anchor="middle">Reading count</text>')
    parts.append(f'<circle class="floor1" cx="{width-230}" cy="30" r="5"/><text x="{width-218}" y="34">FLOOR_1</text>')
    parts.append(f'<circle class="floor2" cx="{width-140}" cy="30" r="5"/><text x="{width-128}" y="34">FLOOR_2</text>')
    path.write_text(svg_shell(width, height, "RSSI Distribution by Floor", "\n".join(parts)))


def timeline_svg(rows, path):
    width, height = 1000, 500
    left, right, top, bottom = 76, 34, 66, 78
    start = min(row["timestamp_dt"] for row in rows)
    end = max(row["timestamp_dt"] for row in rows)
    min_signal = min(row["signalStrength"] for row in rows)
    max_signal = max(row["signalStrength"] for row in rows)
    x = linear_scale(0, (end - start).total_seconds(), left, width - right)
    y = linear_scale(min_signal - 2, max_signal + 2, height - bottom, top)
    parts = []
    for tick in range(math.floor((min_signal - 2) / 5) * 5, math.ceil((max_signal + 2) / 5) * 5 + 1, 5):
        parts.append(f'<line class="grid" x1="{left}" y1="{y(tick):.1f}" x2="{width-right}" y2="{y(tick):.1f}"/>')
        parts.append(f'<text x="{left-10}" y="{y(tick)+4:.1f}" text-anchor="end">{tick}</text>')
    duration = (end - start).total_seconds()
    for fraction in [0, .25, .5, .75, 1]:
        seconds = duration * fraction
        label_time = start.timestamp() + seconds
        label = datetime.fromtimestamp(label_time, tz=timezone.utc).strftime("%H:%M")
        parts.append(f'<line class="grid" x1="{x(seconds):.1f}" y1="{top}" x2="{x(seconds):.1f}" y2="{height-bottom}"/>')
        parts.append(f'<text x="{x(seconds):.1f}" y="{height-bottom+24}" text-anchor="middle">{label}</text>')
    for row in rows:
        klass = "floor1" if row["floor"] == "FLOOR_1" else "floor2"
        seconds = (row["timestamp_dt"] - start).total_seconds()
        parts.append(f'<circle class="{klass}" opacity="0.8" cx="{x(seconds):.1f}" cy="{y(row["signalStrength"]):.1f}" r="3.2"/>')
    parts.append(f'<line class="axis" x1="{left}" y1="{height-bottom}" x2="{width-right}" y2="{height-bottom}"/>')
    parts.append(f'<line class="axis" x1="{left}" y1="{top}" x2="{left}" y2="{height-bottom}"/>')
    parts.append(f'<text x="{width/2}" y="{height-24}" text-anchor="middle">Time (UTC)</text>')
    parts.append(f'<text transform="translate(24 {height/2}) rotate(-90)" text-anchor="middle">Signal strength (dBm)</text>')
    parts.append(f'<circle class="floor1" cx="{width-230}" cy="30" r="5"/><text x="{width-218}" y="34">FLOOR_1</text>')
    parts.append(f'<circle class="floor2" cx="{width-140}" cy="30" r="5"/><text x="{width-128}" y="34">FLOOR_2</text>')
    path.write_text(svg_shell(width, height, "RSSI Readings Over Capture Time", "\n".join(parts)))


def boxplot_svg(rows, path):
    width, height = 760, 460
    left, right, top, bottom = 82, 40, 64, 72
    floors = sorted(set(row["floor"] for row in rows))
    values = [row["signalStrength"] for row in rows]
    x_positions = {floor: left + (idx + 1) * ((width - left - right) / (len(floors) + 1)) for idx, floor in enumerate(floors)}
    y = linear_scale(min(values) - 3, max(values) + 3, height - bottom, top)
    parts = []
    for tick in range(math.floor((min(values) - 3) / 5) * 5, math.ceil((max(values) + 3) / 5) * 5 + 1, 5):
        parts.append(f'<line class="grid" x1="{left}" y1="{y(tick):.1f}" x2="{width-right}" y2="{y(tick):.1f}"/>')
        parts.append(f'<text x="{left-10}" y="{y(tick)+4:.1f}" text-anchor="end">{tick}</text>')
    for floor in floors:
        signals = [row["signalStrength"] for row in rows if row["floor"] == floor]
        x = x_positions[floor]
        q1, median, q3 = pct(signals, 25), statistics.median(signals), pct(signals, 75)
        lo, hi = min(signals), max(signals)
        klass = "floor1" if floor == "FLOOR_1" else "floor2"
        parts.append(f'<line class="{klass}" x1="{x:.1f}" y1="{y(lo):.1f}" x2="{x:.1f}" y2="{y(hi):.1f}" stroke-width="2"/>')
        parts.append(f'<line class="{klass}" x1="{x-34:.1f}" y1="{y(lo):.1f}" x2="{x+34:.1f}" y2="{y(lo):.1f}" stroke-width="2"/>')
        parts.append(f'<line class="{klass}" x1="{x-34:.1f}" y1="{y(hi):.1f}" x2="{x+34:.1f}" y2="{y(hi):.1f}" stroke-width="2"/>')
        parts.append(f'<rect class="{klass}" opacity="0.25" x="{x-48:.1f}" y="{y(q3):.1f}" width="96" height="{y(q1)-y(q3):.1f}"/>')
        parts.append(f'<line class="{klass}" x1="{x-48:.1f}" y1="{y(median):.1f}" x2="{x+48:.1f}" y2="{y(median):.1f}" stroke-width="3"/>')
        parts.append(f'<text x="{x:.1f}" y="{height-bottom+30}" text-anchor="middle">{floor}</text>')
        parts.append(f'<text x="{x:.1f}" y="{y(hi)-10:.1f}" text-anchor="middle" class="muted">mean {statistics.mean(signals):.1f}</text>')
    parts.append(f'<line class="axis" x1="{left}" y1="{height-bottom}" x2="{width-right}" y2="{height-bottom}"/>')
    parts.append(f'<line class="axis" x1="{left}" y1="{top}" x2="{left}" y2="{height-bottom}"/>')
    parts.append(f'<text transform="translate(26 {height/2}) rotate(-90)" text-anchor="middle">Signal strength (dBm)</text>')
    path.write_text(svg_shell(width, height, "Signal Spread by Floor", "\n".join(parts)))


def write_report(rows, overall, floors, model, output_dir):
    chart_files = {
        "histogram": "charts/rssi_distribution_by_floor.svg",
        "timeline": "charts/rssi_timeline.svg",
        "boxplot": "charts/rssi_boxplot_by_floor.svg",
    }
    floor_rows_md = "\n".join(
        f"| {item['floor']} | {item['count']} | {item['mean_dBm']:.2f} | {item['median_dBm']:.2f} | {item['std_dBm']:.2f} | {item['min_dBm']} | {item['q1_dBm']:.2f} | {item['q3_dBm']:.2f} | {item['max_dBm']} |"
        for item in floors
    )
    floor_rows_html = "\n".join(
        f"<tr><td>{item['floor']}</td><td>{item['count']}</td><td>{item['mean_dBm']:.2f}</td><td>{item['median_dBm']:.2f}</td><td>{item['std_dBm']:.2f}</td><td>{item['min_dBm']}</td><td>{item['q1_dBm']:.2f}</td><td>{item['q3_dBm']:.2f}</td><td>{item['max_dBm']}</td></tr>"
        for item in floors
    )
    confusion_rows = "\n".join(
        f"| {actual} | " + " | ".join(str(model["confusion_matrix"][actual][pred]) for pred in sorted(model["confusion_matrix"])) + " |"
        for actual in sorted(model["confusion_matrix"])
    )
    report_md = f"""# WiFi Floor Dataset Analysis

Generated: {datetime.now(timezone.utc).isoformat()}

## Executive Summary

- Total readings: **{overall['row_count']}**
- Floors captured: **{', '.join(f'{k}: {v}' for k, v in overall['floor_counts'].items())}**
- Capture window: **{overall['capture_start_utc']}** to **{overall['capture_end_utc']}** ({overall['capture_duration_minutes']:.1f} minutes)
- Network identity: **{next(iter(overall['ssid_counts']))}**, BSSID **{next(iter(overall['bssid_counts']))}**, frequency **{next(iter(overall['frequency_counts']))} MHz**
- Best simple classifier: **{model['rule']}**
- In-sample classifier accuracy: **{model['accuracy'] * 100:.2f}%**

## Interpretation

Both floors were measured on the same WiFi access point, so RSSI is the useful differentiator in this dataset. FLOOR_1 is substantially stronger on average, while FLOOR_2 is weaker and more variable. The two distributions overlap from about -56 dBm to -50 dBm, so a threshold classifier works well but should be validated with more samples from different positions, phone orientations, and times of day before being treated as production-ready.

## Floor Signal Summary

| Floor | Count | Mean dBm | Median dBm | Std dBm | Min | Q1 | Q3 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
{floor_rows_md}

## Classifier Check

Rule: `{model['rule']}`

Accuracy: **{model['accuracy'] * 100:.2f}%**

Confusion matrix rows are actual floors and columns are predicted floors.

| Actual \\ Predicted | {' | '.join(sorted(model['confusion_matrix']))} |
|---|{'---:|' * len(model['confusion_matrix'])}
{confusion_rows}

## Charts

![RSSI distribution by floor]({chart_files['histogram']})

![RSSI readings over time]({chart_files['timeline']})

![RSSI boxplot by floor]({chart_files['boxplot']})

## Saved Files

- `summary_overall.json`
- `summary_by_floor.csv`
- `threshold_classifier_metrics.json`
- `cleaned_wifi_readings.csv`
- `charts/rssi_distribution_by_floor.svg`
- `charts/rssi_timeline.svg`
- `charts/rssi_boxplot_by_floor.svg`
- `wifi_analysis_report.html`
"""
    (output_dir / "wifi_analysis_report.md").write_text(report_md)

    html_report = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WiFi Floor Dataset Analysis</title>
  <style>
    body {{ margin: 0; font-family: Arial, sans-serif; color: #1f2937; background: #f8fafc; }}
    main {{ max-width: 1080px; margin: 0 auto; padding: 32px 20px 56px; }}
    h1 {{ margin: 0 0 8px; font-size: 32px; }}
    h2 {{ margin-top: 34px; border-bottom: 1px solid #d1d5db; padding-bottom: 8px; }}
    .summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 24px 0; }}
    .metric {{ background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }}
    .metric strong {{ display: block; font-size: 24px; margin-top: 6px; }}
    table {{ border-collapse: collapse; width: 100%; background: #fff; }}
    th, td {{ border: 1px solid #e5e7eb; padding: 10px 12px; text-align: right; }}
    th:first-child, td:first-child {{ text-align: left; }}
    img {{ width: 100%; height: auto; background: #fff; border: 1px solid #e5e7eb; margin: 12px 0 24px; }}
    code {{ background: #eef2ff; padding: 2px 5px; border-radius: 4px; }}
  </style>
</head>
<body>
<main>
  <h1>WiFi Floor Dataset Analysis</h1>
  <p>Generated {datetime.now(timezone.utc).isoformat()}</p>
  <section class="summary">
    <div class="metric">Readings<strong>{overall['row_count']}</strong></div>
    <div class="metric">Capture duration<strong>{overall['capture_duration_minutes']:.1f} min</strong></div>
    <div class="metric">Best threshold<strong>{model['threshold_dBm']:.1f} dBm</strong></div>
    <div class="metric">In-sample accuracy<strong>{model['accuracy'] * 100:.2f}%</strong></div>
  </section>
  <h2>Executive Summary</h2>
  <p>Both floors were measured on the same SSID, BSSID, and frequency. RSSI is therefore the useful differentiator. FLOOR_1 is stronger on average; FLOOR_2 is weaker and more variable. The distributions overlap near the decision boundary, so this threshold should be validated with more samples before production use.</p>
  <p><strong>Rule:</strong> <code>{html.escape(model['rule'])}</code></p>
  <h2>Floor Signal Summary</h2>
  <table>
    <thead><tr><th>Floor</th><th>Count</th><th>Mean dBm</th><th>Median dBm</th><th>Std dBm</th><th>Min</th><th>Q1</th><th>Q3</th><th>Max</th></tr></thead>
    <tbody>{floor_rows_html}</tbody>
  </table>
  <h2>Charts</h2>
  <img src="charts/rssi_distribution_by_floor.svg" alt="RSSI distribution by floor">
  <img src="charts/rssi_timeline.svg" alt="RSSI readings over time">
  <img src="charts/rssi_boxplot_by_floor.svg" alt="RSSI boxplot by floor">
</main>
</body>
</html>
"""
    (output_dir / "wifi_analysis_report.html").write_text(html_report)


def main():
    rows = read_rows(DATASET)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    charts_dir = OUTPUT_DIR / "charts"
    charts_dir.mkdir(exist_ok=True)

    overall = overall_summary(rows)
    floors = floor_summary(rows)
    model = best_threshold(rows)

    (OUTPUT_DIR / "summary_overall.json").write_text(json.dumps(overall, indent=2, default=str))
    (OUTPUT_DIR / "threshold_classifier_metrics.json").write_text(json.dumps(model, indent=2))
    write_csv(
        OUTPUT_DIR / "summary_by_floor.csv",
        floors,
        ["floor", "count", "mean_dBm", "median_dBm", "std_dBm", "min_dBm", "q1_dBm", "q3_dBm", "max_dBm", "first_timestamp_utc", "last_timestamp_utc", "ssid_count", "bssid_count"],
    )
    clean_rows = []
    for row in rows:
        clean_rows.append(
            {
                "timestamp_utc": row["timestamp_dt"].isoformat(),
                "floor": row["floor"],
                "ssid": row["ssid"],
                "bssid": row["bssid"],
                "signalStrength_dBm": row["signalStrength"],
                "frequency_MHz": row["frequency"],
                "connectionType": row["connectionType"],
                "platform": row["platform"],
                "deviceModel": row["deviceModel"],
                "osVersion": row["osVersion"],
            }
        )
    write_csv(
        OUTPUT_DIR / "cleaned_wifi_readings.csv",
        clean_rows,
        ["timestamp_utc", "floor", "ssid", "bssid", "signalStrength_dBm", "frequency_MHz", "connectionType", "platform", "deviceModel", "osVersion"],
    )

    histogram_svg(rows, model["threshold_dBm"], charts_dir / "rssi_distribution_by_floor.svg")
    timeline_svg(rows, charts_dir / "rssi_timeline.svg")
    boxplot_svg(rows, charts_dir / "rssi_boxplot_by_floor.svg")
    write_report(rows, overall, floors, model, OUTPUT_DIR)
    print(OUTPUT_DIR)


if __name__ == "__main__":
    main()
