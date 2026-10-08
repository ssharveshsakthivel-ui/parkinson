"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import QRCode from "react-qr-code";
import DrawingPad from "@/components/DrawingPad";
import DrawingAnalytics from "@/components/DrawingAnalytics";
import type { KinematicData } from "@/components/DrawingPad";

export default function DoctorDashboard() {
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [session, setSession] = useState<any>(null);
    const [myAppointments, setMyAppointments] = useState<any[]>([]);

    const [loading, setLoading] = useState(true);

    // Layout State
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("overview"); // overview, workspace, records

    // QR State
    const [showQR, setShowQR] = useState(false);

    // Inference State
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [inferring, setInferring] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [reportId, setReportId] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState("");
    const [inputMode, setInputMode] = useState<"upload" | "draw">("upload");
    const [kinematicData, setKinematicData] = useState<KinematicData | null>(null);
    const [isCanvasOpen, setIsCanvasOpen] = useState(false);
    const [penIp, setPenIp] = useState<string>("");
    
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Patients Tracking
    const [patients, setPatients] = useState<any[]>([]);
    const [selectedPatient, setSelectedPatient] = useState<string>("");
    const [patientRecords, setPatientRecords] = useState<any[]>([]);

    useEffect(() => {
        const checkSession = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();

                if (!session) {
                    router.push("/login?role=doctor");
                    return;
                }

                const { data: profile } = await supabase
                    .from("profiles")
                    .select("role, full_name")
                    .eq("id", session.user.id)
                    .maybeSingle();

                const role = profile?.role || session.user.user_metadata?.role || "patient";

                if (role !== "doctor") {
                    router.push("/login?role=doctor");
                } else {
                    setSession(session);
                    setUser({
                        ...session.user,
                        full_name: profile?.full_name || session.user.user_metadata?.full_name || session.user.email
                    });
                    fetchPatients(session.user.id);
                    fetchAppointments(session.user.id);
                    fetchPatientRecords(session.user.id);
                }
            } catch (e) {
                console.error("Auth check failed:", e);
                router.push("/login?role=doctor");
            } finally {
                setLoading(false);
            }
        };

        const fetchPatients = async (doctorId: string) => {
            const { data } = await supabase
                .from('doctor_patient_relations')
                .select('patient_id, profiles!doctor_patient_relations_patient_id_fkey(*)')
                .eq('doctor_id', doctorId);

            if (data) {
                setPatients(data.map((d: any) => d.profiles));
            }
        };

        const fetchAppointments = async (doctorId: string) => {
            const { data } = await supabase
                .from('appointments')
                .select('*, profiles!appointments_patient_id_fkey(full_name)')
                .eq('doctor_id', doctorId)
                .order('appointment_date', { ascending: true });
            
            if (data) {
                const patientIds = Array.from(new Set(data.map((a: any) => a.patient_id).filter(Boolean)));
                const levelMap = new Map<string, string>();

                if (patientIds.length > 0) {
                    const { data: levels } = await supabase
                        .from('predictions_and_reports')
                        .select('patient_id, severity_level, analysis_date')
                        .in('patient_id', patientIds)
                        .order('analysis_date', { ascending: false });

                    if (levels) {
                        levels.forEach((item: any) => {
                            if (!levelMap.has(item.patient_id)) {
                                levelMap.set(item.patient_id, item.severity_level || "None");
                            }
                        });
                    }
                }

                setMyAppointments(
                    data.map((apt: any) => ({
                        ...apt,
                        patient_level: levelMap.get(apt.patient_id) || "Not Generated"
                    }))
                );
            }
        };

        const fetchPatientRecords = async (doctorId: string) => {
            const { data } = await supabase
                .from('predictions_and_reports')
                .select('report_id, patient_id, prediction_result, severity_level, confidence_score, doctor_suggestions, analysis_date, profiles!predictions_and_reports_patient_id_fkey(full_name)')
                .eq('doctor_id', doctorId)
                .order('analysis_date', { ascending: false });
            if (data) setPatientRecords(data);
        };

        checkSession();
    }, [router]);

    const handleUpdateAppointment = async (appId: string, status: string) => {
        const { error } = await supabase.from('appointments').update({ status }).eq('id', appId);
        if (!error && user) {
            // Optimistic update
            setMyAppointments(prev => prev.map(a => a.id === appId ? { ...a, status } : a));
        }
    };

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileSelected(e.dataTransfer.files[0]);
        }
    };

    const handleFileSelected = (selectedFile: File) => {
        setFile(selectedFile);
        setResult(null);
        setErrorMsg("");
        const reader = new FileReader();
        reader.onload = (e) => setPreview(e.target?.result as string);
        reader.readAsDataURL(selectedFile);
    };

    const handleLogout = async () => {
        try {
            await supabase.auth.signOut();
            router.push("/");
        } catch (e) {
            console.error(e);
        }
    };

    const executeInference = async (targetFile: File, isDrawing: boolean = false, kData?: KinematicData | null) => {
        setInferring(true);
        setErrorMsg("");
        setResult(null);

        const formData = new FormData();
        formData.append("file", targetFile);
        formData.append("drawing", isDrawing ? "true" : "false");
        if (selectedPatient) {
            formData.append("patient_id", selectedPatient);
        }
        
        if (isDrawing && kData && kData.avgPressure !== undefined) {
            // Scale the 0.0 - 1.0 normalized pressure back to the analog 0-1023 scale expected by the backend
            const scaledPressure = kData.avgPressure * 1023;
            formData.append("avg_pressure", scaledPressure.toString());
        }

        try {
            const response = await fetchApi("/predict", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${session.access_token}`
                },
                body: formData,
            });
            setResult(response.result);
            if (response.report_id) {
                setReportId(response.report_id);
            }

            if (session?.user?.id) {
                const { data: records } = await supabase
                    .from('predictions_and_reports')
                    .select('report_id, patient_id, prediction_result, severity_level, confidence_score, doctor_suggestions, analysis_date, profiles!predictions_and_reports_patient_id_fkey(full_name)')
                    .eq('doctor_id', session.user.id)
                    .order('analysis_date', { ascending: false });
                if (records) setPatientRecords(records);
            }
        } catch (err: any) {
            const message = err?.message || "Failed to run inference";
            setErrorMsg(message);
        } finally {
            setInferring(false);
        }
    };

    const submitInference = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) return;
        await executeInference(file, false);
    };

    if (loading) return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900">
            <div className="w-12 h-12 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-4 text-slate-400 text-sm font-medium tracking-widest uppercase">Securing Connection...</p>
        </div>
    );
    if (!user) return null;

    // Derived stats for Overview
    const today = new Date().toDateString();
    const todaysAppointments = myAppointments.filter(a => new Date(a.appointment_date).toDateString() === today);
    const pendingAppointments = myAppointments.filter(a => a.status === 'scheduled');

    return (
        <div className="flex h-screen bg-[#F8FAFC] text-slate-800 overflow-hidden font-sans">
            
            {/* Modal Overlay for QR */}
            {showQR && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex justify-center items-center animate-fade-in">
                    <div className="bg-white p-10 rounded-[2rem] text-center max-w-md w-full mx-4 shadow-2xl border border-slate-100 transform transition-all">
                        <div className="w-16 h-16 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center mx-auto mb-6">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                        </div>
                        <h2 className="text-2xl font-extrabold mb-3 text-slate-900">Provider Terminal</h2>
                        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                            Ask your patient to scan this QR code from their mobile dashboard to securely link their records to your ledger.
                        </p>
                        <div className="bg-white p-4 rounded-2xl inline-block mb-8 shadow-sm border border-slate-100">
                            <QRCode value={user.id} size={180} />
                        </div>
                        <button onClick={() => setShowQR(false)} className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 transition-colors">Close Terminal</button>
                    </div>
                </div>
            )}

            {/* Sidebar Navigation */}
            <aside className={`w-72 bg-white border-r border-slate-200 flex flex-col transition-all duration-300 z-50 fixed h-full ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${isCanvasOpen ? 'hidden' : ''}`}>
                <div className="p-8 flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="white" strokeWidth="2" fill="none"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-slate-900">NeuroTrace</h1>
                        <p className="text-[10px] uppercase tracking-widest font-bold text-sky-600">Telemedicine Hub</p>
                    </div>
                </div>
                
                <div className="px-4 flex flex-col gap-2 mt-4">
                    <button onClick={() => {setActiveTab('overview'); if (window.innerWidth < 768) setIsSidebarOpen(false);}} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'overview' ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                        Overview
                    </button>
                    <button onClick={() => {setActiveTab('workspace'); if (window.innerWidth < 768) setIsSidebarOpen(false);}} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'workspace' ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
                        Clinical Workspace
                    </button>
                    <button onClick={() => {setActiveTab('records'); if (window.innerWidth < 768) setIsSidebarOpen(false);}} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'records' ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        Patient Registry
                    </button>
                    <button onClick={() => {setActiveTab('messages'); if (window.innerWidth < 768) setIsSidebarOpen(false);}} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'messages' ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                        Messages
                    </button>
                </div>

                <div className="mt-auto p-6 border-t border-slate-100">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 mb-4">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold">
                                {user.full_name.charAt(0)}
                            </div>
                            <div className="overflow-hidden">
                                <p className="text-sm font-bold text-slate-900 truncate">Dr. {user.full_name}</p>
                                <p className="text-xs text-slate-500 truncate">{user.email}</p>
                            </div>
                        </div>
                        <button onClick={() => setShowQR(true)} className="w-full py-2 bg-white text-sky-600 text-xs font-bold rounded-lg border border-sky-100 hover:bg-sky-50 transition-colors shadow-sm">
                            Connect Patient (QR)
                        </button>
                    </div>
                    <button onClick={handleLogout} className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-xl transition-colors">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                        Log Out
                    </button>
                </div>
            </aside>

            {/* Overlay for mobile when sidebar is open */}
            {isSidebarOpen && (
                <div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 md:hidden"></div>
            )}

            {/* Header with Sidebar Toggle */}
            <div className={`fixed top-0 left-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-30 p-4 flex justify-between items-center transition-all duration-300 ${isCanvasOpen ? 'hidden' : ''}`} style={{ paddingLeft: isSidebarOpen ? '19rem' : '1rem' }}>
                <div className="flex items-center gap-4">
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                    </button>
                    {!isSidebarOpen && <span className="font-bold text-slate-800 tracking-tight">NeuroTrace</span>}
                </div>
                
                <div className="flex items-center gap-3">
                    <div 
                        onClick={() => router.push('/doctor/profile')}
                        className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs cursor-pointer hover:bg-indigo-200 transition-colors shadow-sm"
                        title="Edit Provider Profile"
                    >
                        {user.full_name.charAt(0)}
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <main className={`flex-1 overflow-y-auto p-6 md:p-10 pt-24 md:pt-24 scroll-smooth transition-all duration-300 ${isSidebarOpen ? 'md:ml-72' : 'ml-0'}`}>
                
                {/* 1. OVERVIEW TAB */}
                {activeTab === 'overview' && (
                    <div className="max-w-6xl mx-auto animate-fade-in">
                        <header className="mb-10">
                            <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">Welcome back, <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-600 to-indigo-600">Dr. {user.full_name}</span></h1>
                            <p className="text-slate-500 mt-2 text-lg">Here is your clinical overview for today, {today}.</p>
                        </header>

                        {/* Top Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
                                <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Total Patients</p>
                                    <h3 className="text-3xl font-black text-slate-900 mt-1">{patients.length}</h3>
                                </div>
                            </div>
                            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
                                <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center text-sky-600">
                                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Today's Visits</p>
                                    <h3 className="text-3xl font-black text-slate-900 mt-1">{todaysAppointments.length}</h3>
                                </div>
                            </div>
                            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex items-center gap-5 hover:shadow-md transition-shadow">
                                <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Pending Action</p>
                                    <h3 className="text-3xl font-black text-slate-900 mt-1">{pendingAppointments.length}</h3>
                                </div>
                            </div>
                        </div>

                        {/* Split Panels */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Appointments */}
                            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                    <h2 className="text-xl font-bold text-slate-800">Upcoming Appointments</h2>
                                    <span className="bg-sky-100 text-sky-700 text-xs font-bold px-3 py-1 rounded-full">{myAppointments.length} Total</span>
                                </div>
                                <div className="p-6 flex-1 overflow-y-auto max-h-[400px]">
                                    {myAppointments.length > 0 ? (
                                        <div className="flex flex-col gap-4">
                                            {myAppointments.map((apt, idx) => (
                                                <div key={idx} className="group p-4 rounded-2xl border border-slate-100 hover:border-sky-200 hover:shadow-md hover:bg-sky-50/30 transition-all flex justify-between items-center">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold group-hover:bg-white group-hover:text-sky-600 transition-colors">
                                                            {apt.profiles?.full_name?.charAt(0) || "P"}
                                                        </div>
                                                        <div>
                                                            <h4 className="font-bold text-slate-900">{apt.profiles?.full_name || "Unknown"}</h4>
                                                            <p className="text-xs text-slate-500 font-medium">{new Date(apt.appointment_date).toLocaleString()}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-2">
                                                        <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider ${
                                                            apt.status === 'scheduled' ? "bg-amber-100 text-amber-700" : 
                                                            apt.status === 'completed' ? "bg-emerald-100 text-emerald-700" : 
                                                            "bg-slate-100 text-slate-700"
                                                        }`}>
                                                            {apt.status}
                                                        </span>
                                                        {apt.status === 'scheduled' && (
                                                            <select
                                                                value={apt.status}
                                                                onChange={(e) => handleUpdateAppointment(apt.id, e.target.value)}
                                                                className="text-xs border-none bg-transparent text-sky-600 font-semibold cursor-pointer outline-none hover:underline text-right"
                                                            >
                                                                <option value="scheduled">Mark Complete?</option>
                                                                <option value="completed">Complete</option>
                                                                <option value="cancelled">Cancel</option>
                                                            </select>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" strokeWidth="1" fill="none" className="mb-4 opacity-20"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                            <p>No appointments scheduled.</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Quick Action / Recent Scans */}
                            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col relative">
                                <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 to-sky-500 opacity-[0.03] pointer-events-none"></div>
                                <div className="p-6 border-b border-slate-100 flex justify-between items-center z-10">
                                    <h2 className="text-xl font-bold text-slate-800">Quick Actions</h2>
                                </div>
                                <div className="p-8 flex flex-col justify-center items-center h-full text-center z-10">
                                    <div className="w-20 h-20 bg-gradient-to-tr from-sky-400 to-indigo-500 rounded-full flex items-center justify-center shadow-xl shadow-sky-500/30 mb-6">
                                        <svg viewBox="0 0 24 24" width="32" height="32" stroke="white" strokeWidth="2" fill="none"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
                                    </div>
                                    <h3 className="text-2xl font-bold text-slate-900 mb-2">Run Diagnostics</h3>
                                    <p className="text-slate-500 mb-8 max-w-xs mx-auto">Access the AI engine to evaluate new MRI scans, drawing tests, or live FSR sensor data.</p>
                                    <button onClick={() => setActiveTab('workspace')} className="px-8 py-3.5 bg-slate-900 text-white rounded-xl font-bold shadow-lg hover:shadow-xl hover:bg-slate-800 transition-all hover:-translate-y-1">
                                        Open Workspace &rarr;
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 2. CLINICAL WORKSPACE TAB */}
                {activeTab === 'workspace' && (
                    <div className="max-w-6xl mx-auto animate-fade-in">
                        <header className="mb-10 text-left">
                            <div className="flex items-center gap-3 mb-2">
                                <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">Active Session</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-extrabold mb-3 leading-tight text-slate-900">Clinical <span className="text-indigo-600">Workspace</span></h1>
                            <p className="text-slate-500 text-lg max-w-2xl">Deploy neural models for real-time Parkinson's assessment across multiple modalities.</p>
                        </header>

                        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 items-start">
                            {/* Input Column */}
                            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-2">
                                {/* Modality Tabs */}
                                <div className="flex p-2 bg-slate-100/50 rounded-[1.5rem] mb-4">
                                    <button onClick={() => {setInputMode("upload"); setIsCanvasOpen(false);}} className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all ${inputMode === "upload" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>MRI / Scan</button>
                                    <button onClick={() => setInputMode("draw")} className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all ${inputMode === "draw" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>Drawing Test (Smart Pen)</button>
                                </div>

                                <div className="p-6">
                                    {inputMode === "draw" ? (
                                        isCanvasOpen ? (
                                            <DrawingPad 
                                                smartPenIp={penIp}
                                                onSave={(f, isDrawing, kData) => {
                                                    setIsCanvasOpen(false);
                                                    handleFileSelected(f);
                                                    setKinematicData(kData);
                                                    setInputMode("upload");
                                                    executeInference(f, isDrawing, kData);
                                                }} 
                                                onCancel={() => setIsCanvasOpen(false)}
                                            />
                                        ) : (
                                            <div className="animate-fade-in">
                                                <div className="bg-slate-50 rounded-2xl p-8 border border-slate-200 text-center mb-6">
                                                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100 text-indigo-500">
                                                        <svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" strokeWidth="2" fill="none"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>
                                                    </div>
                                                    <h3 className="text-xl font-bold text-slate-800 mb-2">Smart Pen Setup</h3>
                                                    <p className="text-slate-500 text-sm mb-6 max-w-sm mx-auto">Configure your FSR-enabled smart pen connection before starting the drawing assessment.</p>
                                                    
                                                    <div className="max-w-xs mx-auto text-left">
                                                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">WiFi Pen IP (Optional)</label>
                                                        <input 
                                                            type="text" 
                                                            value={penIp}
                                                            onChange={(e) => setPenIp(e.target.value)}
                                                            placeholder="e.g. 192.168.1.50"
                                                            className="w-full text-center text-lg font-bold text-slate-900 bg-white border-2 border-slate-200 rounded-xl py-3 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none"
                                                        />
                                                        <p className="text-[10px] text-slate-400 mt-2 text-center">Leave blank to use standard touch/mouse input.</p>
                                                    </div>
                                                </div>

                                                <button onClick={() => setIsCanvasOpen(true)} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-indigo-600/30 transition-all flex justify-center items-center gap-2">
                                                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                                                    Launch Drawing Board
                                                </button>
                                            </div>
                                        )
                                    ) : (
                                        <form onSubmit={submitInference} className="animate-fade-in">
                                            <div className="mb-6">
                                                <label className="block mb-2 text-slate-700 text-sm font-semibold">Assign to Patient Profile (Optional)</label>
                                                <select
                                                    value={selectedPatient}
                                                    onChange={(e) => setSelectedPatient(e.target.value)}
                                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 outline-none text-sm focus:border-indigo-500 focus:bg-white transition-all cursor-pointer"
                                                >
                                                    <option value="">--- Unassigned / Testing ---</option>
                                                    {patients.map((p, idx) => (
                                                        <option key={idx} value={p.id}>{p.full_name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div
                                                onClick={() => fileInputRef.current?.click()}
                                                onDragOver={handleDragOver}
                                                onDragLeave={handleDragLeave}
                                                onDrop={handleDrop}
                                                className={`rounded-2xl border-2 p-10 text-center cursor-pointer transition-all duration-300 relative overflow-hidden min-h-[320px] flex flex-col justify-center items-center ${isDragging ? "bg-indigo-50 border-indigo-400 border-dashed scale-[1.02]" : "bg-slate-50 border-slate-300 border-dashed hover:bg-slate-100 hover:border-slate-400"}`}
                                            >
                                                <input
                                                    type="file"
                                                    ref={fileInputRef}
                                                    accept=".png,.jpg,.jpeg,.bmp,.webp"
                                                    className="hidden"
                                                    onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
                                                />

                                                {preview ? (
                                                    <div className="absolute inset-2 rounded-xl overflow-hidden bg-white shadow-sm border border-slate-100">
                                                        <img src={preview} alt="Scan preview" className="w-full h-full object-contain p-2" />
                                                        {inferring && <div className="absolute inset-0 h-[30%] bg-gradient-to-b from-transparent to-indigo-500/20" style={{ animation: "scan 2s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate" }}></div>}
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="w-16 h-16 mb-4 text-indigo-400 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100">
                                                            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                                                        </div>
                                                        <p className="font-bold text-slate-800 text-lg">Upload Medical Media</p>
                                                        <p className="text-slate-500 text-sm mt-2">Drag and drop imaging files here<br/>(PNG, JPG, BMP)</p>
                                                    </>
                                                )}
                                            </div>

                                            {errorMsg && <p className="text-red-600 text-sm mt-4 text-center bg-red-50 p-4 rounded-xl border border-red-200 font-medium animate-fade-in">{errorMsg}</p>}

                                            <button
                                                className="w-full py-4 mt-6 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-lg shadow-lg shadow-slate-900/20 transition-all disabled:opacity-50 flex justify-center items-center gap-2"
                                                type="submit"
                                                disabled={inferring || !file}
                                            >
                                                {inferring ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>}
                                                {inferring ? "Executing Matrix..." : "Run Analysis Engine"}
                                            </button>
                                        </form>
                                    )}
                                </div>
                            </div>

                            {/* Analytics Column */}
                            <div className="flex flex-col gap-6">
                                <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 lg:p-8 min-h-[300px] flex flex-col relative overflow-hidden">
                                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100 z-10">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${result ? (result.predicted_class === "Parkinson" ? "bg-red-100 text-red-600" : result.predicted_class === "Healthy" ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600") : "bg-slate-100 text-slate-400"}`}>
                                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                                        </div>
                                        <h2 className="text-lg font-bold text-slate-800">Diagnostic Output</h2>
                                    </div>

                                    {!result && !inferring && (
                                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center z-10">
                                            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4 opacity-30"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
                                            <p className="text-sm">Engine standby. Provide input data<br/>to generate a clinical assessment.</p>
                                        </div>
                                    )}

                                    {inferring && (
                                        <div className="flex-1 flex flex-col items-center justify-center text-indigo-500 text-center animate-pulse z-10">
                                            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                                            <p className="tracking-widest uppercase text-xs font-bold">Computing probabilities...</p>
                                        </div>
                                    )}

                                    {result && (() => {
                                        const isParkinson = result.predicted_class === "Parkinson";
                                        const isBorderline = result.predicted_class === "Borderline";

                                        const bgColor = isParkinson ? "bg-red-500" : isBorderline ? "bg-amber-500" : "bg-emerald-500";
                                        const lightBg = isParkinson ? "bg-red-50" : isBorderline ? "bg-amber-50" : "bg-emerald-50";
                                        const textColor = isParkinson ? "text-red-700" : isBorderline ? "text-amber-700" : "text-emerald-700";

                                        return (
                                            <div className="animate-fade-in z-10 flex-1 flex flex-col">
                                                <div className={`p-6 rounded-2xl ${lightBg} border border-white/50 shadow-sm mb-6 relative overflow-hidden`}>
                                                    <div className={`absolute top-0 left-0 w-1 h-full ${bgColor}`}></div>
                                                    <p className={`text-[10px] uppercase tracking-widest mb-1 font-bold ${textColor} opacity-70`}>Primary Finding</p>
                                                    <h3 className={`text-2xl font-black mb-4 ${textColor}`}>{isParkinson ? "Parkinson's Indicated" : isBorderline ? "Inconclusive / Borderline" : "Healthy Pattern"}</h3>
                                                    
                                                    <div className="bg-white rounded-xl p-4 flex justify-between items-center shadow-sm">
                                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Confidence</span>
                                                        <span className={`text-2xl font-black ${textColor}`}>{(result.confidence * 100).toFixed(1)}%</span>
                                                    </div>
                                                </div>

                                                {result.reason && (
                                                    <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm text-slate-700">
                                                        <strong>Sensor Insight:</strong> {result.reason} (Value: {result.average_pressure})
                                                    </div>
                                                )}

                                                {isBorderline && (
                                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 leading-relaxed mb-6 font-medium">
                                                        ⚠️ The model flagged unusual patterns but lacks confidence for a definite positive. Clinical review recommended.
                                                    </div>
                                                )}

                                                <div className="mt-auto pt-4 border-t border-slate-100">
                                                    {reportId ? (
                                                        <button onClick={() => window.open(`/report?id=${reportId}`, '_blank')} className="w-full py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm flex items-center justify-center gap-2">
                                                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                                                            Open Detailed Report
                                                        </button>
                                                    ) : (
                                                        <p className="text-center text-xs text-slate-400 italic">No patient assigned. Report not saved.</p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>

                            </div>
                        </div>

                        {/* Kinematics - Full width below the grid */}
                        {kinematicData && (
                            <div className="mt-8 animate-fade-in">
                                <DrawingAnalytics data={kinematicData} />
                            </div>
                        )}
                    </div>
                )}

                {/* 3. PATIENT RECORDS TAB */}
                {activeTab === 'records' && (
                    <div className="max-w-6xl mx-auto animate-fade-in">
                        <header className="mb-10 text-left">
                            <h1 className="text-4xl md:text-5xl font-extrabold mb-3 leading-tight text-slate-900">Patient <span className="text-emerald-600">Registry</span></h1>
                            <p className="text-slate-500 text-lg max-w-2xl">Access longitudinal health records and past diagnostic reports for assigned patients.</p>
                        </header>

                        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                <h2 className="text-xl font-bold text-slate-800">Historical Database</h2>
                                <div className="relative">
                                    <input type="text" placeholder="Search records..." className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-full text-sm outline-none focus:border-emerald-500 w-64 shadow-sm" />
                                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" className="absolute left-4 top-2.5 text-slate-400"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs uppercase tracking-wider font-bold">
                                            <th className="p-5 font-bold">Patient Name</th>
                                            <th className="p-5 font-bold">Date of Scan</th>
                                            <th className="p-5 font-bold">Result</th>
                                            <th className="p-5 font-bold">Severity</th>
                                            <th className="p-5 font-bold">Notes</th>
                                            <th className="p-5 font-bold text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {patientRecords.length > 0 ? patientRecords.map((rec, idx) => (
                                            <tr key={rec.report_id || idx} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors group">
                                                <td className="p-5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">
                                                            {rec.profiles?.full_name?.charAt(0) || "U"}
                                                        </div>
                                                        <span className="font-bold text-slate-800">{rec.profiles?.full_name || "Unknown"}</span>
                                                    </div>
                                                </td>
                                                <td className="p-5 text-sm text-slate-500 font-medium">
                                                    {new Date(rec.analysis_date).toLocaleDateString()}
                                                </td>
                                                <td className="p-5">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded-md bg-slate-100 ${rec.prediction_result === 'Parkinson' ? 'text-red-700 bg-red-50' : rec.prediction_result === 'Borderline' ? 'text-amber-700 bg-amber-50' : 'text-emerald-700 bg-emerald-50'}`}>
                                                        {rec.prediction_result || "N/A"}
                                                    </span>
                                                </td>
                                                <td className="p-5">
                                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest ${rec.severity_level === 'Higher Level' ? 'bg-red-100 text-red-700' : rec.severity_level === 'Lower Level' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                                        {rec.severity_level || "None"}
                                                    </span>
                                                </td>
                                                <td className="p-5 text-sm text-slate-500 max-w-xs truncate" title={rec.doctor_suggestions}>
                                                    {rec.doctor_suggestions || "No notes."}
                                                </td>
                                                <td className="p-5 text-right">
                                                    <button onClick={() => window.open(`/report?id=${rec.report_id}`, '_blank')} className="text-emerald-600 font-bold text-xs hover:underline flex items-center justify-end gap-1">
                                                        View PDF <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                                    </button>
                                                </td>
                                            </tr>
                                        )) : (
                                            <tr>
                                                <td colSpan={6} className="p-12 text-center text-slate-400">
                                                    No historical records found. Generate a report in the Clinical Workspace to begin.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* 4. MESSAGES TAB */}
                {activeTab === 'messages' && (
                    <div className="max-w-6xl mx-auto animate-fade-in">
                        <header className="mb-10 text-left">
                            <h1 className="text-4xl md:text-5xl font-extrabold mb-3 leading-tight text-slate-900">Patient <span className="text-sky-600">Messages</span></h1>
                            <p className="text-slate-500 text-lg max-w-2xl">Securely communicate with your connected patients.</p>
                        </header>

                        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                <h2 className="text-xl font-bold text-slate-800">Connected Patients</h2>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs uppercase tracking-wider font-bold">
                                            <th className="p-5 font-bold">Patient Name</th>
                                            <th className="p-5 font-bold">Contact Number</th>
                                            <th className="p-5 font-bold text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {patients.length > 0 ? patients.map((p, idx) => (
                                            <tr key={p.id || idx} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors group">
                                                <td className="p-5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold text-xs">
                                                            {p.full_name?.charAt(0) || "P"}
                                                        </div>
                                                        <span className="font-bold text-slate-800">{p.full_name || "Unknown"}</span>
                                                    </div>
                                                </td>
                                                <td className="p-5 text-sm text-slate-500 font-medium">
                                                    {p.contact_number || "N/A"}
                                                </td>
                                                <td className="p-5 text-right">
                                                    <button onClick={() => router.push(`/doctor/chat?patient=${p.id}`)} className="text-sky-600 font-bold text-xs hover:underline flex items-center justify-end gap-1 px-4 py-2 bg-sky-50 rounded-lg hover:bg-sky-100 transition-colors ml-auto">
                                                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Message
                                                    </button>
                                                </td>
                                            </tr>
                                        )) : (
                                            <tr>
                                                <td colSpan={3} className="p-12 text-center text-slate-400">
                                                    No connected patients found. Use the QR code to connect.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </main>
            
            <style dangerouslySetInnerHTML={{
                __html: `
        @keyframes scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(300%); }
        }
      `}} />
        </div>
    );
}
