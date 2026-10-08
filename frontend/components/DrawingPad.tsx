"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";

/* ─── Kinematic types ─────────────────────────────────────────────────────── */
export interface StrokePoint {
    x: number;
    y: number;
    t: number;          // Date.now() timestamp (ms)
    vx?: number;        // velocity-x  (px/ms)
    vy?: number;        // velocity-y  (px/ms)
    speed?: number;     // scalar speed (px/ms)
    pressure?: number;  // FSR / Stylus pressure (0.0 to 1.0)
}

export interface StrokeData {
    points: StrokePoint[];
    duration: number;   // ms
    avgSpeed: number;   // px/s
    maxSpeed: number;   // px/s
    avgPressure?: number;
}

export interface KinematicData {
    strokes: StrokeData[];
    allPoints: StrokePoint[];  // flattened for global analysis
    totalDuration: number;     // ms — total pen-down time
    pauseCount: number;        // number of pen lifts
    avgSpeed: number;          // px/s — across all strokes
    maxSpeed: number;          // px/s
    speedStdDev: number;       // px/s — variability
    avgPressure?: number;      // global average pressure
    drawingStartTime: number;
    drawingEndTime: number;
}

interface DrawingPadProps {
    onSave: (file: File, isDrawing: true, kinematicData: KinematicData) => void;
    onCancel?: () => void;
    smartPenIp?: string | null;
}

export default function DrawingPad({ onSave, onCancel, smartPenIp }: DrawingPadProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasDrawn, setHasDrawn] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // ── Kinematic state ──────────────────────────────────────────────────────
    const currentStrokeRef = useRef<StrokePoint[]>([]);
    const allStrokesRef = useRef<StrokeData[]>([]);
    const drawingStartRef = useRef<number>(0);
    const lastPointRef = useRef<StrokePoint | null>(null);

    // ── Smart Pen Hardware State ─────────────────────────────────────────────
    const [penStatus, setPenStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
    const hardwarePressureRef = useRef<number | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    // ── Live HUD state ───────────────────────────────────────────────────────
    const [liveSpeed, setLiveSpeed] = useState(0);       // px/s
    const [livePressure, setLivePressure] = useState(0); // 0-100%
    const [elapsedTime, setElapsedTime] = useState(0);    // seconds
    const [strokeCount, setStrokeCount] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Hover to Start State ─────────────────────────────────────────────────
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const latestHoverEventRef = useRef<React.PointerEvent<HTMLCanvasElement> | null>(null);

    const checkHoverTimer = useCallback(() => {
        if (latestHoverEventRef.current) {
            startDrawing(latestHoverEventRef.current);
        }
    }, []);

    const initCanvas = useCallback((width: number, height: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);
        
        // Draw center dot
        const centerX = width / 2;
        const centerY = height / 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#ef4444"; // red dot
        ctx.fill();
        ctx.closePath();

        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#1e293b"; // slate-800 for better visibility in light theme

    }, []);

    useEffect(() => {
        const handleResize = () => {
            setDimensions({ width: window.innerWidth, height: window.innerHeight });
        };
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        if (dimensions.width > 0 && dimensions.height > 0) {
            initCanvas(dimensions.width, dimensions.height);
        }
    }, [dimensions, initCanvas]);

    // ── Timer for elapsed time ───────────────────────────────────────────────
    const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (wsRef.current) wsRef.current.close();
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        };
    }, []);

    // ── Smart Pen Auto-Connect ───────────────────────────────────────────────
    useEffect(() => {
        if (!smartPenIp) return;
        
        setPenStatus("connecting");
        if (wsRef.current) wsRef.current.close();

        try {
            const ws = new WebSocket(`ws://${smartPenIp}:81/`);
            ws.onopen = () => {
                setPenStatus("connected");
            };
            ws.onmessage = (event) => {
                const pressure = parseFloat(event.data);
                if (!isNaN(pressure)) {
                    hardwarePressureRef.current = pressure;
                    setLivePressure(Math.round(pressure * 100));
                }
            };
            ws.onerror = () => {
                setPenStatus("disconnected");
            };
            ws.onclose = () => {
                setPenStatus("disconnected");
                hardwarePressureRef.current = null;
            };
            wsRef.current = ws;
        } catch (e) {
            setPenStatus("disconnected");
        }
        
        return () => {
            if (wsRef.current) wsRef.current.close();
        };
    }, [smartPenIp]);

    const getCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        
        // Use native pointer pressure by default
        let pressure = e.pressure !== undefined ? e.pressure : 0.5;
        
        // Override with hardware pen if connected and sending data
        if (hardwarePressureRef.current !== null) {
            pressure = hardwarePressureRef.current;
        }

        return { 
            x: e.clientX - rect.left, 
            y: e.clientY - rect.top,
            pressure
        };
    };

    const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const coords = getCoords(e);
        if (!coords) return;

        setIsDrawing(true);
        if (!hasDrawn) {
            setHasDrawn(true);
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.fillStyle = "white";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.lineCap = "round";
                    ctx.lineJoin = "round";
                    ctx.strokeStyle = "#1e293b";
                }
            }
            drawingStartRef.current = Date.now();
            // Start elapsed timer
            timerRef.current = setInterval(() => {
                setElapsedTime(Math.floor((Date.now() - drawingStartRef.current) / 1000));
            }, 200);
        }

        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
        }
        autoSaveTimerRef.current = setTimeout(() => {
            handleSave(true);
        }, 5000);

        const point: StrokePoint = { x: coords.x, y: coords.y, t: Date.now(), speed: 0, pressure: coords.pressure };
        currentStrokeRef.current = [point];
        lastPointRef.current = point;
        setLivePressure(Math.round(coords.pressure * 100));

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx) {
            ctx.beginPath();
            ctx.moveTo(coords.x, coords.y);
            ctx.lineWidth = 2; // uniform line width
        }
    };

    const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const coords = getCoords(e);
        if (!coords) return;

        if (!isDrawing) {
            const centerX = dimensions.width / 2;
            const centerY = dimensions.height / 2;
            const dist = Math.hypot(coords.x - centerX, coords.y - centerY);
            
            if (dist < 20) {
                // Keep updating the latest event so we can start drawing at the correct spot
                latestHoverEventRef.current = e;
                if (!hoverTimeoutRef.current) {
                    hoverTimeoutRef.current = setTimeout(checkHoverTimer, 3000);
                }
            } else {
                if (hoverTimeoutRef.current) {
                    clearTimeout(hoverTimeoutRef.current);
                    hoverTimeoutRef.current = null;
                }
                latestHoverEventRef.current = null;
            }
            return;
        }
        
        e.preventDefault();

        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
        }
        autoSaveTimerRef.current = setTimeout(() => {
            handleSave(true);
        }, 5000);

        const now = Date.now();
        const prev = lastPointRef.current;

        let speed = 0;
        let vx = 0;
        let vy = 0;
        if (prev) {
            const dt = now - prev.t;
            if (dt > 0) {
                const dx = coords.x - prev.x;
                const dy = coords.y - prev.y;
                vx = dx / dt;
                vy = dy / dt;
                speed = Math.sqrt(vx * vx + vy * vy); // px/ms
            }
        }

        const point: StrokePoint = { x: coords.x, y: coords.y, t: now, vx, vy, speed, pressure: coords.pressure };
        currentStrokeRef.current.push(point);
        lastPointRef.current = point;

        // Update live speed HUD (convert px/ms → px/s)
        setLiveSpeed(Math.round(speed * 1000));
        setLivePressure(Math.round(coords.pressure * 100));

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx) {
            ctx.lineTo(coords.x, coords.y);
            ctx.lineWidth = 2; // uniform line width
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(coords.x, coords.y);
        }
    };

    const stopDrawing = () => {
        if (!isDrawing) return;
        setIsDrawing(false);

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx) ctx.closePath();

        // Finalize current stroke
        const pts = currentStrokeRef.current;
        if (pts.length >= 2) {
            const speeds = pts.filter(p => p.speed !== undefined && p.speed > 0).map(p => p.speed! * 1000);
            const duration = pts[pts.length - 1].t - pts[0].t;
            const avgSpd = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
            const maxSpd = speeds.length > 0 ? Math.max(...speeds) : 0;
            
            const pressures = pts.filter(p => p.pressure !== undefined).map(p => p.pressure!);
            const avgPress = pressures.length > 0 ? pressures.reduce((a, b) => a + b, 0) / pressures.length : 0;

            const stroke: StrokeData = {
                points: [...pts],
                duration,
                avgSpeed: avgSpd,
                maxSpeed: maxSpd,
                avgPressure: avgPress,
            };
            allStrokesRef.current.push(stroke);
            setStrokeCount(allStrokesRef.current.length);
        }

        currentStrokeRef.current = [];
        lastPointRef.current = null;
        setLiveSpeed(0);
    };

    const clearCanvas = () => {
        initCanvas(dimensions.width, dimensions.height);
        setHasDrawn(false);
        allStrokesRef.current = [];
        currentStrokeRef.current = [];
        lastPointRef.current = null;
        setStrokeCount(0);
        setElapsedTime(0);
        setLiveSpeed(0);
        drawingStartRef.current = 0;
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
        latestHoverEventRef.current = null;
    };

    const buildKinematicData = (isAutoSave: boolean = false): KinematicData => {
        const strokes = allStrokesRef.current;
        const allPoints = strokes.flatMap(s => s.points);
        const allSpeeds = allPoints.filter(p => p.speed !== undefined && p.speed > 0).map(p => p.speed! * 1000);

        const totalDuration = strokes.reduce((sum, s) => sum + s.duration, 0);
        const avgSpeed = allSpeeds.length > 0 ? allSpeeds.reduce((a, b) => a + b, 0) / allSpeeds.length : 0;
        const maxSpeed = allSpeeds.length > 0 ? Math.max(...allSpeeds) : 0;

        // Standard deviation
        const mean = avgSpeed;
        const variance = allSpeeds.length > 1
            ? allSpeeds.reduce((sum, s) => sum + (s - mean) ** 2, 0) / (allSpeeds.length - 1)
            : 0;
        const speedStdDev = Math.sqrt(variance);
        
        const allPressures = allPoints.filter(p => p.pressure !== undefined).map(p => p.pressure!);
        const globalAvgPressure = allPressures.length > 0 ? allPressures.reduce((a, b) => a + b, 0) / allPressures.length : 0;

        let endTime = Date.now();
        if (isAutoSave) {
            endTime -= 5000;
        }

        return {
            strokes,
            allPoints,
            totalDuration,
            pauseCount: Math.max(0, strokes.length - 1),
            avgSpeed,
            maxSpeed,
            speedStdDev,
            avgPressure: globalAvgPressure,
            drawingStartTime: drawingStartRef.current,
            drawingEndTime: endTime,
        };
    };

    const handleSave = (isAutoSave: boolean = false) => {
        if (isDrawing) {
            stopDrawing();
        }

        // Only save if there's actual drawing (prevent auto-saving just the center dot before they start)
        if (allStrokesRef.current.length === 0 && currentStrokeRef.current.length === 0) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        // Stop timers
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
        let found = false;

        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const i = (y * canvas.width + x) * 4;
                if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    found = true;
                }
            }
        }

        if (!found) return;

        const boxWidth = maxX - minX;
        const boxHeight = maxY - minY;
        const padding = 40;
        const size = Math.max(boxWidth, boxHeight) + (padding * 2);

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = size;
        tempCanvas.height = size;
        const tempCtx = tempCanvas.getContext("2d");
        if (!tempCtx) return;

        tempCtx.fillStyle = "white";
        tempCtx.fillRect(0, 0, size, size);

        const dx = (size - boxWidth) / 2;
        const dy = (size - boxHeight) / 2;

        tempCtx.drawImage(
            canvas,
            minX, minY, boxWidth, boxHeight,
            dx, dy, boxWidth, boxHeight
        );

        // Build kinematic data before the async blob callback
        const kinematicData = buildKinematicData(isAutoSave);

        tempCanvas.toBlob((blob) => {
            if (blob) {
                const downloadUrl = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = downloadUrl;
                link.download = `Parkinson_Drawing_${Date.now()}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(downloadUrl);

                const file = new File([blob], "drawing.png", { type: "image/png" });
                onSave(file, true, kinematicData);
            }
        }, "image/png");
    };

    if (dimensions.width === 0) return null;

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
    };

    return (
        <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "#f8fafc", // slate-50
            zIndex: 9999,
            display: "flex",
            flexDirection: "column"
        }}>
            {/* Header bar */}
            <div style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                padding: "15px 20px",
                background: "rgba(255,255,255,0.9)",
                color: "#0f172a", // slate-900
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                zIndex: 10000,
                boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
                borderBottom: "1px solid #e2e8f0",
                backdropFilter: "blur(10px)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#ef4444", animation: "pulse 2s infinite" }} />
                    <span style={{ fontWeight: 600, fontSize: "1.1rem" }}>Interactive Drawing Analysis</span>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                    {smartPenIp && (
                        <div style={{ padding: "8px 16px", borderRadius: "6px", border: penStatus === "connected" ? "1px solid #10b981" : "1px solid #cbd5e1", background: penStatus === "connected" ? "#ecfdf5" : "transparent", color: penStatus === "connected" ? "#10b981" : "#64748b", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                            {penStatus === "connected" ? "🟢 Pen Linked" : penStatus === "connecting" ? "⏳ Linking..." : "🔴 Disconnected"}
                        </div>
                    )}
                    {onCancel && (
                        <button
                            type="button"
                            onClick={onCancel}
                            style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "transparent", color: "#64748b", cursor: "pointer" }}
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={clearCanvas}
                        style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #fca5a5", background: "transparent", color: "#ef4444", cursor: "pointer" }}
                    >
                        Clear Board
                    </button>
                    <button
                        type="button"
                        onClick={() => handleSave(false)}
                        disabled={!hasDrawn}
                        style={{ padding: "8px 20px", borderRadius: "6px", border: "none", background: "#0ea5e9", color: "white", fontWeight: 600, cursor: !hasDrawn ? "not-allowed" : "pointer", opacity: !hasDrawn ? 0.5 : 1 }}
                    >
                        OK - Analyze
                    </button>
                </div>
            </div>

            {/* ── Live HUD overlay ─────────────────────────────────────────────── */}
            {hasDrawn && (
                <div style={{
                    position: "absolute",
                    bottom: 20,
                    left: 20,
                    zIndex: 10000,
                    display: "flex",
                    gap: "12px",
                    pointerEvents: "none",
                }}>
                    {/* Speed */}
                    <div style={{
                        background: "rgba(255,255,255,0.95)",
                        backdropFilter: "blur(12px)",
                        borderRadius: "14px",
                        padding: "14px 20px",
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
                        minWidth: "100px",
                        textAlign: "center",
                    }}>
                        <div style={{
                            fontSize: "1.6rem",
                            fontWeight: 800,
                            color: liveSpeed > 800 ? "#ef4444" : liveSpeed > 400 ? "#f59e0b" : "#10b981",
                            lineHeight: 1,
                            transition: "color 0.2s",
                            fontVariantNumeric: "tabular-nums",
                        }}>
                            {liveSpeed}
                        </div>
                        <div style={{ fontSize: "0.65rem", color: "#64748b", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "bold" }}>
                            px/s
                        </div>
                    </div>
                    
                    {/* Pressure (FSR) */}
                    <div style={{
                        background: "rgba(255,255,255,0.95)",
                        backdropFilter: "blur(12px)",
                        borderRadius: "14px",
                        padding: "14px 20px",
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
                        minWidth: "90px",
                        textAlign: "center",
                    }}>
                        <div style={{
                            fontSize: "1.6rem",
                            fontWeight: 800,
                            color: livePressure < 30 ? "#f59e0b" : livePressure > 70 ? "#ef4444" : "#10b981",
                            lineHeight: 1,
                            transition: "color 0.2s",
                            fontVariantNumeric: "tabular-nums",
                        }}>
                            {livePressure}<span style={{fontSize: "1rem"}}>%</span>
                        </div>
                        <div style={{ fontSize: "0.65rem", color: "#64748b", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "bold" }}>
                            Pressure
                        </div>
                    </div>

                    {/* Elapsed Time */}
                    <div style={{
                        background: "rgba(255,255,255,0.95)",
                        backdropFilter: "blur(12px)",
                        borderRadius: "14px",
                        padding: "14px 20px",
                        border: "1px solid #e2e8f0",
                        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
                        minWidth: "80px",
                        textAlign: "center",
                    }}>
                        <div style={{
                            fontSize: "1.6rem",
                            fontWeight: 800,
                            color: "#0ea5e9",
                            lineHeight: 1,
                            fontVariantNumeric: "tabular-nums",
                        }}>
                            {formatTime(elapsedTime)}
                        </div>
                        <div style={{ fontSize: "0.65rem", color: "#64748b", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "bold" }}>
                            Elapsed
                        </div>
                    </div>
                </div>
            )}

            {/* The Fullscreen Canvas */}
            <canvas
                ref={canvasRef}
                width={dimensions.width}
                height={dimensions.height}
                style={{
                    cursor: "crosshair",
                    touchAction: "none",
                    display: "block"
                }}
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerOut={stopDrawing}
                onPointerCancel={stopDrawing}
            />
        </div>
    );
}
