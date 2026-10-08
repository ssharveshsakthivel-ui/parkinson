"use client";

import React, { useEffect, useRef, useMemo } from "react";
import type { KinematicData, StrokePoint } from "./DrawingPad";

/* ═══════════════════════════════════════════════════════════════════════════
   DrawingAnalytics — premium kinematic analysis dashboard (Medical Theme)
   Computes: speed metrics, tremor score, FFT frequency, path deviation
   Renders:  sparkline chart, tremor waveform, radial gauge, metric cards
   ═══════════════════════════════════════════════════════════════════════════ */

interface DrawingAnalyticsProps {
    data: KinematicData;
}

/* ── Utility: simple FFT (Cooley-Tukey radix-2 DIT) ──────────────────────── */
function fft(re: number[], im: number[]): { re: number[]; im: number[] } {
    const n = re.length;
    if (n <= 1) return { re: [...re], im: [...im] };

    // Bit-reversal permutation
    const outRe = new Array(n);
    const outIm = new Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
        let rev = 0;
        for (let j = 0; j < bits; j++) {
            rev = (rev << 1) | ((i >> j) & 1);
        }
        outRe[rev] = re[i];
        outIm[rev] = im[i];
    }

    for (let size = 2; size <= n; size *= 2) {
        const half = size / 2;
        const angle = -2 * Math.PI / size;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);

        for (let i = 0; i < n; i += size) {
            let curRe = 1, curIm = 0;
            for (let j = 0; j < half; j++) {
                const tRe = curRe * outRe[i + j + half] - curIm * outIm[i + j + half];
                const tIm = curRe * outIm[i + j + half] + curIm * outRe[i + j + half];
                outRe[i + j + half] = outRe[i + j] - tRe;
                outIm[i + j + half] = outIm[i + j] - tIm;
                outRe[i + j] += tRe;
                outIm[i + j] += tIm;
                const newCurRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = newCurRe;
            }
        }
    }
    return { re: outRe, im: outIm };
}

function nextPow2(n: number): number {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

/* ── Compute smoothed path (moving average) ──────────────────────────────── */
function smoothPath(points: StrokePoint[], windowSize: number = 7): StrokePoint[] {
    if (points.length < windowSize) return points;
    const smoothed: StrokePoint[] = [];
    const half = Math.floor(windowSize / 2);
    for (let i = 0; i < points.length; i++) {
        let sx = 0, sy = 0, count = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(points.length - 1, i + half); j++) {
            sx += points[j].x;
            sy += points[j].y;
            count++;
        }
        smoothed.push({ ...points[i], x: sx / count, y: sy / count });
    }
    return smoothed;
}

/* ── Compute direction changes (sign changes in angular velocity) ─────── */
function countDirectionChanges(points: StrokePoint[]): number {
    if (points.length < 3) return 0;
    let changes = 0;
    let prevAngle = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
    for (let i = 2; i < points.length; i++) {
        const angle = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
        let diff = angle - prevAngle;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        if (i >= 3) {
            const prevPrevAngle = Math.atan2(points[i - 1].y - points[i - 2].y, points[i - 1].x - points[i - 2].x);
            let prevDiff = prevAngle - prevPrevAngle;
            while (prevDiff > Math.PI) prevDiff -= 2 * Math.PI;
            while (prevDiff < -Math.PI) prevDiff += 2 * Math.PI;
            if (Math.sign(diff) !== Math.sign(prevDiff) && Math.abs(diff) > 0.1) {
                changes++;
            }
        }
        prevAngle = angle;
    }
    return changes;
}

/* ── Compute jerk (derivative of acceleration) ───────────────────────────── */
function computeAvgJerk(points: StrokePoint[]): number {
    if (points.length < 4) return 0;
    const jerks: number[] = [];
    for (let i = 3; i < points.length; i++) {
        const dt1 = points[i].t - points[i - 1].t;
        const dt2 = points[i - 1].t - points[i - 2].t;
        const dt3 = points[i - 2].t - points[i - 3].t;
        if (dt1 <= 0 || dt2 <= 0 || dt3 <= 0) continue;

        const v3 = Math.sqrt(((points[i].x - points[i - 1].x) / dt1) ** 2 + ((points[i].y - points[i - 1].y) / dt1) ** 2);
        const v2 = Math.sqrt(((points[i - 1].x - points[i - 2].x) / dt2) ** 2 + ((points[i - 1].y - points[i - 2].y) / dt2) ** 2);
        const v1 = Math.sqrt(((points[i - 2].x - points[i - 3].x) / dt3) ** 2 + ((points[i - 2].y - points[i - 3].y) / dt3) ** 2);

        const a2 = (v3 - v2) / dt1;
        const a1 = (v2 - v1) / dt2;
        const jerk = Math.abs(a2 - a1) / ((dt1 + dt2) / 2);
        jerks.push(jerk);
    }
    return jerks.length > 0 ? jerks.reduce((a, b) => a + b, 0) / jerks.length : 0;
}

/* ═══════════════════════════════════════════════════════════════════════════ */

export default function DrawingAnalytics({ data }: DrawingAnalyticsProps) {
    const speedChartRef = useRef<HTMLCanvasElement>(null);
    const tremorChartRef = useRef<HTMLCanvasElement>(null);
    const gaugeRef = useRef<HTMLCanvasElement>(null);

    /* ── Compute all metrics ──────────────────────────────────────────────── */
    const metrics = useMemo(() => {
        const pts = data.allPoints;
        if (pts.length < 5) {
            return {
                avgSpeed: 0, speedStdDev: 0, maxSpeed: 0, avgPressure: 0,
                tremorScore: 0, dominantFreq: 0, tremorAmplitude: 0,
                drawDuration: 0, pauseCount: 0, directionChanges: 0,
                avgJerk: 0, speeds: [] as number[], deviations: [] as number[],
                severityLabel: "Insufficient Data",
                severityColor: "#94a3b8", // slate-400
            };
        }

        // Speeds (px/s)
        const speeds = pts.filter(p => p.speed !== undefined).map(p => p.speed! * 1000);

        // Tremor amplitude: deviation of raw path from smoothed path
        const smooth = smoothPath(pts, 9);
        const deviations = pts.map((p, i) => {
            if (i >= smooth.length) return 0;
            return Math.sqrt((p.x - smooth[i].x) ** 2 + (p.y - smooth[i].y) ** 2);
        });
        const tremorAmplitude = deviations.reduce((a, b) => a + b, 0) / deviations.length;

        // Direction changes
        const directionChanges = countDirectionChanges(pts);
        const dirChangesPerSec = data.totalDuration > 0
            ? (directionChanges / (data.totalDuration / 1000))
            : 0;

        // Average jerk
        const avgJerk = computeAvgJerk(pts);

        // FFT for tremor frequency
        let dominantFreq = 0;
        if (pts.length >= 16) {
            const n = nextPow2(pts.length);
            const signal: number[] = [];
            for (let i = 0; i < n; i++) {
                if (i < deviations.length) {
                    signal.push(deviations[i]);
                } else {
                    signal.push(0);
                }
            }
            const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
            const centered = signal.map(v => v - mean);
            const im = new Array(n).fill(0);
            const result = fft(centered, im);

            const totalTimeS = (pts[pts.length - 1].t - pts[0].t) / 1000;
            const sampleRate = pts.length / totalTimeS;

            let maxMag = 0;
            let maxIdx = 0;
            for (let i = 1; i < n / 2; i++) {
                const mag = Math.sqrt(result.re[i] ** 2 + result.im[i] ** 2);
                if (mag > maxMag) {
                    maxMag = mag;
                    maxIdx = i;
                }
            }
            dominantFreq = (maxIdx * sampleRate) / n;
        }

        const ampScore = Math.min(tremorAmplitude / 8, 1) * 30;         
        const dirScore = Math.min(dirChangesPerSec / 15, 1) * 25;       
        const jerkScore = Math.min(avgJerk * 50000, 1) * 25;            
        const varScore = data.speedStdDev > 0
            ? Math.min(data.speedStdDev / 500, 1) * 20                  
            : 0;
        const tremorScore = Math.round(Math.min(ampScore + dirScore + jerkScore + varScore, 100));

        let severityLabel = "Minimal Tremor";
        let severityColor = "#10b981"; // emerald
        if (tremorScore >= 60) {
            severityLabel = "Significant Tremor";
            severityColor = "#ef4444"; // red
        } else if (tremorScore >= 30) {
            severityLabel = "Moderate Tremor";
            severityColor = "#f59e0b"; // amber
        }

        return {
            avgSpeed: data.avgSpeed,
            speedStdDev: data.speedStdDev,
            maxSpeed: data.maxSpeed,
            avgPressure: data.avgPressure || 0,
            tremorScore,
            dominantFreq,
            tremorAmplitude,
            drawDuration: data.totalDuration / 1000,
            pauseCount: data.pauseCount,
            directionChanges,
            avgJerk,
            speeds,
            deviations,
            severityLabel,
            severityColor,
        };
    }, [data]);

    /* ── Draw speed sparkline ─────────────────────────────────────────────── */
    useEffect(() => {
        const canvas = speedChartRef.current;
        if (!canvas || metrics.speeds.length < 2) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, w, h);

        let speeds = metrics.speeds;
        if (speeds.length > 200) {
            const step = Math.ceil(speeds.length / 200);
            speeds = speeds.filter((_: number, i: number) => i % step === 0);
        }

        const maxSpd = Math.max(...speeds, 1);
        const stepX = w / (speeds.length - 1);

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "rgba(56, 189, 248, 0.2)");
        grad.addColorStop(1, "rgba(56, 189, 248, 0)");

        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < speeds.length; i++) {
            const x = i * stepX;
            const y = h - (speeds[i] / maxSpd) * (h - 10);
            if (i === 0) ctx.lineTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i < speeds.length; i++) {
            const x = i * stepX;
            const y = h - (speeds[i] / maxSpd) * (h - 10);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "#0ea5e9";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const threshY = h - (400 / maxSpd) * (h - 10);
        if (threshY > 0 && threshY < h) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = "rgba(239, 68, 68, 0.5)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, threshY);
            ctx.lineTo(w, threshY);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }, [metrics.speeds]);

    /* ── Draw tremor waveform ─────────────────────────────────────────────── */
    useEffect(() => {
        const canvas = tremorChartRef.current;
        if (!canvas || metrics.deviations.length < 2) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, w, h);

        let devs = metrics.deviations;
        if (devs.length > 200) {
            const step = Math.ceil(devs.length / 200);
            devs = devs.filter((_: number, i: number) => i % step === 0);
        }

        const maxDev = Math.max(...devs, 1);
        const mid = h / 2;
        const stepX = w / (devs.length - 1);

        ctx.beginPath();
        for (let i = 0; i < devs.length; i++) {
            const x = i * stepX;
            const amplitude = (devs[i] / maxDev) * (h / 2 - 5);
            const y = mid + (i % 2 === 0 ? -1 : 1) * amplitude;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }

        const tremorGrad = ctx.createLinearGradient(0, 0, w, 0);
        tremorGrad.addColorStop(0, "#6366f1");
        tremorGrad.addColorStop(0.5, "#f59e0b");
        tremorGrad.addColorStop(1, "#ef4444");
        ctx.strokeStyle = tremorGrad;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.strokeStyle = "rgba(0,0,0,0.1)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(w, mid);
        ctx.stroke();
        ctx.setLineDash([]);
    }, [metrics.deviations]);

    /* ── Draw radial gauge ────────────────────────────────────────────────── */
    useEffect(() => {
        const canvas = gaugeRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const size = canvas.clientWidth;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, size, size);

        const cx = size / 2;
        const cy = size / 2;
        const radius = size / 2 - 12;
        const lineW = 10;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0.75 * Math.PI, 2.25 * Math.PI);
        ctx.strokeStyle = "rgba(0,0,0,0.05)";
        ctx.lineWidth = lineW;
        ctx.lineCap = "round";
        ctx.stroke();

        const fraction = metrics.tremorScore / 100;
        const startAngle = 0.75 * Math.PI;
        const endAngle = startAngle + fraction * 1.5 * Math.PI;

        const gaugeGrad = ctx.createLinearGradient(0, size, size, 0);
        gaugeGrad.addColorStop(0, "#10b981");
        gaugeGrad.addColorStop(0.5, "#f59e0b");
        gaugeGrad.addColorStop(1, "#ef4444");

        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.strokeStyle = gaugeGrad;
        ctx.lineWidth = lineW;
        ctx.lineCap = "round";
        ctx.stroke();

        ctx.fillStyle = "#1e293b"; // slate-800
        ctx.font = `bold ${size * 0.22}px 'Outfit', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(metrics.tremorScore), cx, cy - 4);

        ctx.fillStyle = "#64748b"; // slate-500
        ctx.font = `${size * 0.08}px 'Outfit', sans-serif`;
        ctx.fillText("TREMOR", cx, cy + size * 0.14);
    }, [metrics.tremorScore]);

    /* ── Metric card helper ───────────────────────────────────────────────── */
    const MetricCard = ({ label, value, unit, icon, color }: { label: string; value: string | number; unit?: string; icon: string; color: string }) => {
        let bgClass = "bg-slate-100";
        if (color === "#38bdf8") bgClass = "bg-sky-50 text-sky-600";
        if (color === "#f59e0b") bgClass = "bg-amber-50 text-amber-600";
        if (color === "#818cf8") bgClass = "bg-indigo-50 text-indigo-600";
        if (color === "#ef4444") bgClass = "bg-red-50 text-red-600";
        if (color === "#6ee7b7") bgClass = "bg-emerald-50 text-emerald-600";
        if (color === "#fbbf24") bgClass = "bg-yellow-50 text-yellow-600";
        if (color === "#c084fc") bgClass = "bg-purple-50 text-purple-600";

        return (
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex items-center gap-4 transition-all duration-300 hover:border-slate-300">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${bgClass}`}>
                    {icon}
                </div>
                <div className="flex-1">
                    <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                        {label}
                    </div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-xl font-bold text-slate-800 tabular-nums">
                            {value}
                        </span>
                        {unit && <span className="text-xs text-slate-400 font-medium">{unit}</span>}
                    </div>
                </div>
            </div>
        );
    };

    if (data.allPoints.length < 5) {
        return (
            <div className="glass-panel p-8 text-center text-slate-500 bg-slate-50">
                <p>Not enough drawing data for kinematic analysis. Please draw at least a short stroke.</p>
            </div>
        );
    }

    return (
        <div className="glass-panel p-8 bg-white border-slate-200" style={{ borderTop: `4px solid ${metrics.severityColor}` }}>
            {/* Header */}
            <div className="flex items-center gap-4 mb-6 pb-4 border-b border-slate-100">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                </div>
                <div>
                    <h2 className="text-lg font-bold m-0 text-slate-800">
                        Kinematic Analysis
                    </h2>
                    <p className="text-xs text-slate-500 m-0">
                        Drawing speed &amp; tremor pattern metrics
                    </p>
                </div>
                <div className="ml-auto">
                    <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-wide" style={{
                        color: metrics.severityColor,
                        background: `${metrics.severityColor}15`,
                        border: `1px solid ${metrics.severityColor}30`,
                    }}>
                        {metrics.severityLabel}
                    </span>
                </div>
            </div>

            {/* Top row: Gauge + Key Metrics */}
            <div className="flex flex-col lg:flex-row gap-6 mb-6">
                {/* Radial Gauge */}
                <div className="flex items-center justify-center lg:w-40 shrink-0">
                    <canvas
                        ref={gaugeRef}
                        style={{ width: "130px", height: "130px" }}
                    />
                </div>

                {/* Metric Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                    <MetricCard
                        label="Avg Speed"
                        value={metrics.avgSpeed.toFixed(0)}
                        unit="px/s"
                        icon="⚡"
                        color="#38bdf8"
                    />
                    <MetricCard
                        label="Speed Variability"
                        value={metrics.speedStdDev.toFixed(0)}
                        unit="σ px/s"
                        icon="📊"
                        color="#f59e0b"
                    />
                    <MetricCard
                        label="Tremor Freq"
                        value={metrics.dominantFreq.toFixed(1)}
                        unit="Hz"
                        icon="〰️"
                        color="#818cf8"
                    />
                    <MetricCard
                        label="Path Deviation"
                        value={metrics.tremorAmplitude.toFixed(1)}
                        unit="px"
                        icon="📐"
                        color="#ef4444"
                    />
                </div>
            </div>

            {/* Speed Sparkline */}
            <div className="bg-slate-50 rounded-2xl p-5 mb-4 border border-slate-200">
                <div className="flex justify-between items-center mb-3">
                    <span className="text-sm font-semibold text-slate-700">
                        Speed Over Time
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                        Max: {metrics.maxSpeed.toFixed(0)} px/s
                    </span>
                </div>
                <canvas
                    ref={speedChartRef}
                    className="w-full h-20 block"
                />
            </div>

            {/* Tremor Waveform */}
            <div className="bg-slate-50 rounded-2xl p-5 mb-4 border border-slate-200">
                <div className="flex justify-between items-center mb-3">
                    <span className="text-sm font-semibold text-slate-700">
                        Tremor Waveform
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                        Path deviation from smooth trajectory
                    </span>
                </div>
                <canvas
                    ref={tremorChartRef}
                    className="w-full h-16 block"
                />
            </div>

            {/* Bottom stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard
                    label="Duration"
                    value={metrics.drawDuration.toFixed(1)}
                    unit="sec"
                    icon="⏱️"
                    color="#6ee7b7"
                />
                <MetricCard
                    label="Pauses"
                    value={metrics.pauseCount}
                    icon="✋"
                    color="#fbbf24"
                />
                <MetricCard
                    label="Dir. Changes"
                    value={metrics.directionChanges}
                    icon="🔀"
                    color="#c084fc"
                />
                <MetricCard
                    label="Avg Pressure"
                    value={Math.round(metrics.avgPressure * 100)}
                    unit="%"
                    icon="👆"
                    color="#f43f5e"
                />
            </div>

            {/* Disclaimer */}
            <p className="mt-6 text-[11px] text-slate-400 font-medium text-center tracking-wide">
                Kinematic metrics are for research reference only · Not a clinical diagnostic
            </p>
        </div>
    );
}
