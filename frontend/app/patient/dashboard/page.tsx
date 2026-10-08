"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fetchApi } from "@/lib/api";
import { QrReader } from "react-qr-reader";
import DrawingPad from "@/components/DrawingPad";
import type { KinematicData } from "@/components/DrawingPad";
import DrawingAnalytics from "@/components/DrawingAnalytics";

export default function PatientDashboard() {
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [profile, setProfile] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Connections & Scanning
    const [scanning, setScanning] = useState(false);
    const [scanMsg, setScanMsg] = useState("");
    const [myDoctors, setMyDoctors] = useState<any[]>([]);
    const [myReports, setMyReports] = useState<any[]>([]);

    // Appointments
    const [myAppointments, setMyAppointments] = useState<any[]>([]);
    const [bookingDoc, setBookingDoc] = useState("");
    const [bookingDate, setBookingDate] = useState("");

    // Layout & Analysis State
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("records");
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [inferring, setInferring] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [errorMsg, setErrorMsg] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [inputMode, setInputMode] = useState<"upload" | "draw">("upload");
    const [kinematicData, setKinematicData] = useState<KinematicData | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const checkSession = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();

                if (!session) {
                    router.push("/login?role=patient");
                    return;
                }

                const role = session.user.user_metadata?.role || "patient";
                if (role !== "patient") {
                    router.push("/login?role=patient");
                    return;
                }

                setUser({
                    ...session.user,
                    full_name: session.user.user_metadata?.full_name || session.user.email
                });

                // Fetch Extended Profile
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', session.user.id)
                    .single();

                if (profileData) {
                    setProfile(profileData);
                }

                fetchConnections(session.user.id);
                fetchReports(session.user.id);
                fetchAppointments(session.user.id);

            } catch (e) {
                console.error("Auth check failed:", e);
                router.push("/login?role=patient");
            } finally {
                setLoading(false);
            }
        };
        checkSession();
    }, [router]);

    const fetchConnections = async (patientId: string) => {
        const { data } = await supabase
            .from('doctor_patient_relations')
            .select('doctor_id, profiles!doctor_patient_relations_doctor_id_fkey(full_name)')
            .eq('patient_id', patientId);

        if (data) {
            setMyDoctors(data);
        }
    };

    const fetchReports = async (patientId: string) => {
        const { data } = await supabase
            .from('predictions_and_reports')
            .select('*, profiles!predictions_and_reports_doctor_id_fkey(full_name)')
            .eq('patient_id', patientId)
            .order('analysis_date', { ascending: false });

        if (data) {
            setMyReports(data);
        }
    };

    const fetchAppointments = async (patientId: string) => {
        const { data } = await supabase
            .from('appointments')
            .select('*, profiles!appointments_doctor_id_fkey(full_name)')
            .eq('patient_id', patientId)
            .order('appointment_date', { ascending: true });
        if (data) setMyAppointments(data);
    };

    const handleBookAppointment = async (e: any) => {
        e.preventDefault();
        if (!bookingDoc || !bookingDate || !user) return;

        const { error } = await supabase.from('appointments').insert({
            patient_id: user.id,
            doctor_id: bookingDoc,
            appointment_date: new Date(bookingDate).toISOString(),
            status: 'scheduled'
        });

        if (!error) {
            setBookingDoc("");
            setBookingDate("");
            fetchAppointments(user.id);
        }
    };

    const handleLogout = async () => {
        try {
            await supabase.auth.signOut();
            router.push("/");
        } catch (e) {
            console.error(e);
        }
    };

    const handleScan = async (result: any, error: any) => {
        if (result && user) {
            setScanning(false);
            const doctorId = result?.text;
            if (!doctorId) return;

            setScanMsg("Linking to Doctor...");

            const { error: dbErr } = await supabase.from('doctor_patient_relations').insert({
                doctor_id: doctorId,
                patient_id: user.id,
                status: 'active'
            });

            if (dbErr) {
                if (dbErr.code === '23505') {
                    setScanMsg("✓ Already connected to this Doctor");
                } else {
                    setScanMsg(`Connection failed: ${dbErr.message}`);
                }
            } else {
                setScanMsg("✓ Secure Link Established!");
                fetchConnections(user.id);
            }

            setTimeout(() => setScanMsg(""), 4000);
        }
    };

    const handleFileSelected = (selectedFile: File) => {
        setFile(selectedFile);
        setPreview(URL.createObjectURL(selectedFile));
        setResult(null);
        setErrorMsg("");
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

    const executeInference = async (targetFile: File, isDrawing: boolean = false) => {
        setInferring(true);
        setErrorMsg("");
        setResult(null);

        try {
            const formData = new FormData();
            formData.append("file", targetFile);
            formData.append("drawing", isDrawing ? "true" : "false");
            
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error("Not authenticated");

            const response = await fetchApi("/predict", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${session.access_token}`
                },
                body: formData,
            });

            setResult(response.result);
            await fetchReports(session.user.id);
        } catch(err: any) {
            const message = err?.message || "Failed to run inference";
            if (message.toLowerCase().includes("failed to fetch")) {
                setErrorMsg("Cannot reach analysis backend. Ensure Flask API is running on port 8088.");
            } else {
                setErrorMsg(message);
            }
        } finally {
            setInferring(false);
        }
    };

    const submitInference = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) {
            setErrorMsg("Please upload an image first.");
            return;
        }
        await executeInference(file, false);
    };

    if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Authenticating securely...</div>;
    if (!user) return null;
    const latestSeverityLevel = myReports?.[0]?.severity_level || result?.severity_level || "Not Generated";

    return (
        <div className="flex h-screen bg-[#F8FAFC] text-slate-800 overflow-hidden font-sans">

            {scanning && (
                <div className="fixed inset-0 bg-slate-900/80 z-[9999] flex flex-col justify-center items-center backdrop-blur-sm animate-fade-in">
                    <div className="w-full max-w-md bg-white rounded-3xl overflow-hidden shadow-2xl border border-slate-200">
                        <QrReader
                            onResult={handleScan}
                            constraints={{ facingMode: 'environment' }}
                        />
                    </div>
                    <button onClick={() => setScanning(false)} className="mt-8 px-6 py-2 rounded-full border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 shadow-sm">Cancel Scan</button>
                    <p className="mt-6 text-sm text-slate-200">Point camera at Doctor's unique QR profile code.</p>
                </div>
            )}

            <aside className={`w-72 bg-white border-r border-slate-200 flex flex-col transition-all duration-300 z-50 fixed h-full ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} ${inputMode === 'draw' && activeTab === 'analysis' ? 'hidden' : ''}`}>
                <div className="p-8 flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="white" strokeWidth="2" fill="none"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-slate-900">NeuroTrace</h1>
                        <p className="text-[10px] uppercase tracking-widest font-bold text-sky-600">Patient Portal</p>
                    </div>
                </div>
                
                <div className="px-4 flex flex-col gap-2 mt-4">
                    <button onClick={() => {setActiveTab('records'); if (window.innerWidth < 768) setIsSidebarOpen(false);}} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'records' ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        Medical Dashboard
                    </button>
                    <button onClick={() => {setActiveTab('analysis'); if (window.innerWidth < 768) setIsSidebarOpen(false);}} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all ${activeTab === 'analysis' ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                        Self-Analysis
                    </button>
                    <button onClick={() => {router.push('/patient/profile'); if (window.innerWidth < 768) setIsSidebarOpen(false);}} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all text-slate-500 hover:bg-slate-50 hover:text-slate-700`}>
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        Edit Profile
                    </button>
                </div>

                <div className="mt-auto p-6 border-t border-slate-100">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 mb-4">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold">
                                {user.full_name?.charAt(0) || "U"}
                            </div>
                            <div className="overflow-hidden">
                                <p className="text-sm font-bold text-slate-900 truncate">{user.full_name}</p>
                                <p className="text-xs text-slate-500 truncate">{user.email}</p>
                            </div>
                        </div>
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
            <div className={`fixed top-0 left-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-30 p-4 flex justify-between items-center transition-all duration-300 ${inputMode === 'draw' && activeTab === 'analysis' ? 'hidden' : ''}`} style={{ paddingLeft: isSidebarOpen ? '19rem' : '1rem' }}>
                <div className="flex items-center gap-4">
                    <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                    </button>
                    {!isSidebarOpen && <span className="font-bold text-slate-800 tracking-tight">NeuroTrace</span>}
                </div>
                
                <div className="flex items-center gap-3">
                    <div 
                        onClick={() => router.push('/patient/profile')}
                        className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold text-xs cursor-pointer hover:bg-sky-200 transition-colors shadow-sm"
                        title="Edit Patient Profile"
                    >
                        {user.full_name?.charAt(0) || "U"}
                    </div>
                </div>
            </div>

            <main className={`flex-1 overflow-y-auto p-6 md:p-10 pt-24 md:pt-24 scroll-smooth transition-all duration-300 ${isSidebarOpen ? 'md:ml-72' : 'ml-0'}`}>
                {activeTab === 'records' && (
                    <div className="max-w-5xl animate-fade-in">
                        <header className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-10">
                            <div>
                                <h1 className="text-4xl md:text-5xl font-extrabold mb-2 text-slate-900">Medical <span className="text-sky-600">Records</span></h1>
                                <p className="text-slate-500 text-lg">View your latest diagnostic scans and physician notes below.</p>
                            </div>
                            <div>
                                <button onClick={() => setScanning(true)} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg hover:bg-slate-800 transition-colors flex items-center gap-3">
                                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><rect x="7" y="7" width="10" height="10"></rect></svg>
                                    Connect Doctor QR
                                </button>
                                {scanMsg && <div className={`mt-3 text-sm text-right font-medium ${scanMsg.includes("failed") ? "text-red-500" : "text-emerald-600"}`}>{scanMsg}</div>}
                            </div>
                        </header>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2.5fr] gap-8">
                            {/* Left Column: Connections & Profile */}
                            <div className="flex flex-col gap-8">
                                {/* Connected Providers */}
                                <section className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-sky-400 to-indigo-500"></div>
                                    <h2 className="text-xl font-bold border-b border-slate-100 pb-4 mb-6 text-slate-800">
                                        Clinical Team
                                    </h2>
                                    {myDoctors.length > 0 ? (
                                        <div className="flex flex-col gap-3">
                                            {myDoctors.map((doc, idx) => (
                                                <div key={idx} className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex justify-between items-center hover:bg-slate-100 transition-colors">
                                                    <div>
                                                        <p className="font-semibold text-slate-800">Dr. {doc.profiles?.full_name || "Unknown"}</p>
                                                        <p className="text-sm text-slate-500 mt-0.5">Primary Care Link</p>
                                                    </div>
                                                    <button
                                                        onClick={() => router.push(`/patient/chat?doctor=${doc.doctor_id}`)}
                                                        className="px-4 py-2 text-sm bg-white text-sky-600 border border-sky-200 shadow-sm rounded-lg hover:bg-sky-50 transition-all"
                                                    >
                                                        Message
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-slate-500 text-sm">No providers connected. Scan a doctor's QR code to build your care team.</p>
                                    )}
                                </section>

                                {/* Appointments Section */}
                                <section className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-400 to-purple-500"></div>
                                    <h2 className="text-xl font-bold border-b border-slate-100 pb-4 mb-6 text-slate-800">
                                        Appointments
                                    </h2>

                                    <form onSubmit={handleBookAppointment} className="mb-6 bg-slate-50 p-5 rounded-2xl border border-slate-200">
                                        <h3 className="text-sm font-semibold text-slate-700 mb-2">Book New Visit</h3>
                                        <p className="text-xs text-slate-500 mb-4">
                                            Latest Analysis Level: <strong className="text-slate-800">{latestSeverityLevel}</strong>
                                        </p>
                                        <div className="flex flex-col gap-3">
                                            <select value={bookingDoc} onChange={(e) => setBookingDoc(e.target.value)} className="w-full bg-white border border-slate-300 text-slate-800 rounded-xl p-3 focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none transition-all shadow-sm">
                                                <option value="">Select Provider</option>
                                                {myDoctors.map((d, i) => (
                                                    <option key={i} value={d.doctor_id}>Dr. {d.profiles?.full_name}</option>
                                                ))}
                                            </select>
                                            <input type="datetime-local" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="w-full bg-white border border-slate-300 text-slate-800 rounded-xl p-3 focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none transition-all shadow-sm" />
                                            <button type="submit" disabled={!bookingDoc || !bookingDate} className={`w-full py-3 mt-1 bg-slate-900 text-white rounded-xl font-bold shadow-lg hover:bg-slate-800 transition-all ${(!bookingDoc || !bookingDate) ? 'opacity-50 cursor-not-allowed' : ''}`}>Schedule Visit</button>
                                        </div>
                                    </form>

                                    {myAppointments.length > 0 ? (
                                        <div className="flex flex-col gap-3">
                                            {myAppointments.map((apt, idx) => (
                                                <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm">
                                                    <div>
                                                        <p className="font-semibold text-slate-800">Dr. {apt.profiles?.full_name || "Unknown"}</p>
                                                        <p className="text-xs text-slate-500 mt-1">
                                                            {new Date(apt.appointment_date).toLocaleString()}
                                                        </p>
                                                        <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
                                                            Level at booking: {latestSeverityLevel}
                                                        </p>
                                                    </div>
                                                    <span className="text-xs font-bold px-2 py-1 rounded-md uppercase" style={{
                                                        background: apt.status === 'scheduled' ? "#e0f2fe" : apt.status === 'completed' ? "#d1fae5" : "#fee2e2",
                                                        color: apt.status === 'scheduled' ? "#0369a1" : apt.status === 'completed' ? "#047857" : "#b91c1c"
                                                    }}>
                                                        {apt.status}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-slate-500 text-sm">No upcoming appointments scheduled.</p>
                                    )}
                                </section>

                                {/* Medical Profile Panel */}
                                <section className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-teal-500"></div>
                                    <h2 className="text-xl font-bold border-b border-slate-100 pb-4 mb-6 text-slate-800">
                                        Comprehensive Profile
                                    </h2>

                                    {profile ? (
                                        <div className="flex flex-col gap-4">
                                            <div className="flex justify-between">
                                                <span className="text-slate-500 text-sm">Age</span>
                                                <span className="text-slate-800 font-medium">{profile.age}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500 text-sm">Gender</span>
                                                <span className="text-slate-800 font-medium">{profile.gender}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-500 text-sm">Contact ID</span>
                                                <span className="text-slate-800 font-medium">{profile.contact_number}</span>
                                            </div>
                                            <div className="flex flex-col mt-2">
                                                <span className="text-slate-500 text-sm mb-1">Registered Address</span>
                                                <span className="text-slate-700 font-normal text-sm bg-slate-50 p-3 rounded-lg border border-slate-200">{profile.address}</span>
                                            </div>

                                            <div className="h-px bg-slate-100 my-2"></div>

                                            <div className="flex justify-between items-center">
                                                <span className="text-slate-500 text-sm">Prior Neurological Cond.</span>
                                                <span className={`text-xs font-bold px-3 py-1 rounded-full ${profile.neurological_condition ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                                                    {profile.neurological_condition ? "YES" : "NO"}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center mt-2">
                                                <span className="text-slate-500 text-sm">Family History (Parkinson's)</span>
                                                <span className={`text-xs font-bold px-3 py-1 rounded-full ${profile.family_history ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                                                    {profile.family_history ? "DETECTED" : "NONE"}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-slate-500 text-sm">Loading profile metrics...</p>
                                    )}
                                </section>
                            </div>

                            {/* Right Column: Records & Reports Section */}
                            <section className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm self-start">
                                <h2 className="text-xl font-bold border-b border-slate-100 pb-4 mb-6 text-slate-800">
                                    Diagnostic Reports
                                </h2>

                                {myReports.length > 0 ? (
                                    <div className="flex flex-col gap-6">
                                        {myReports.map((r, idx) => (
                                            <div key={idx} className="p-6 bg-white rounded-2xl border border-slate-200 hover:border-slate-300 shadow-sm transition-colors group">
                                                <div className="flex justify-between mb-4">
                                                    <div>
                                                        <h3 className="m-0 text-lg font-semibold text-slate-800 group-hover:text-sky-600 transition-colors">CNN Analysis: {r.prediction_result}</h3>
                                                        <p className="m-0 text-slate-500 text-sm mt-1">
                                                            {new Date(r.analysis_date).toLocaleDateString()} &bull; Dr. {r.profiles?.full_name || "Unknown"}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                                                            r.severity_level === 'Higher Level' ? "bg-red-100 text-red-700" : 
                                                            r.severity_level === 'Lower Level' ? "bg-amber-100 text-amber-700" : 
                                                            "bg-emerald-100 text-emerald-700"
                                                        }`}>
                                                            {r.severity_level}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="p-4 bg-slate-50 rounded-xl border-l-4 border-l-sky-500 mb-5">
                                                    <p className="m-0 text-sm text-slate-700 font-medium italic">
                                                        "{r.doctor_suggestions}"
                                                    </p>
                                                </div>

                                                <button
                                                    onClick={() => window.open(`/report?id=${r.report_id}`, '_blank')}
                                                    className="w-full py-3 text-sm font-bold bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
                                                >
                                                    View Full PDF Report Document
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-center">
                                        <p className="text-slate-500 text-sm font-medium">No reports have been generated by a doctor yet.</p>
                                        <p className="text-slate-400 text-xs mt-2">Connect with a specialist to initiate a CNN Scan Analysis.</p>
                                    </div>
                                )}
                            </section>
                        </div>
                    </div>
                )}
                
                {activeTab === 'analysis' && (
                    <div className="max-w-5xl animate-fade-in">
                        <header className="mb-10 text-left">
                            <h1 className="text-4xl md:text-5xl font-extrabold mb-2 text-slate-900">Predictive <span className="text-sky-600">Analysis</span></h1>
                            <p className="text-slate-500 text-lg">Upload a neural MRI/scan for ultra-fast Custom CNN inference.</p>
                        </header>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2.5fr] gap-8">
                            <section className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm">
                                <div className="flex items-center gap-3 mb-8 pb-4 border-b border-slate-100">
                                    <div className="w-6 h-6 text-sky-500">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                                    </div>
                                    <h2 className="text-xl font-bold text-slate-800">Input Feed</h2>
                                    <div className="ml-auto flex gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                                        <button 
                                            type="button" 
                                            onClick={() => setInputMode("upload")} 
                                            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${inputMode === "upload" ? "bg-white text-slate-800 shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-700"}`}
                                        >
                                            Upload Scan
                                        </button>
                                        <button 
                                            type="button" 
                                            onClick={() => setInputMode("draw")} 
                                            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${inputMode === "draw" ? "bg-white text-slate-800 shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-700"}`}
                                        >
                                            Drawing Pad
                                        </button>
                                    </div>
                                </div>

                                {inputMode === "draw" ? 
                                    <DrawingPad 
                                        onSave={(f, isDrawing, kData) => {
                                            handleFileSelected(f);
                                            setKinematicData(kData);
                                            setInputMode("upload");
                                            executeInference(f, isDrawing);
                                        }} 
                                        onCancel={() => setInputMode("upload")}
                                    />
                                : 
                                <form onSubmit={submitInference}>
                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                        className={`rounded-3xl border-2 p-10 text-center cursor-pointer transition-all duration-300 relative overflow-hidden min-h-[300px] flex flex-col justify-center items-center ${isDragging ? "bg-sky-50 border-sky-400 border-dashed scale-[1.02]" : "bg-slate-50 border-slate-300 border-dashed hover:bg-slate-100 hover:border-slate-400"}`}
                                    >
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            accept=".png,.jpg,.jpeg,.bmp,.webp"
                                            className="hidden"
                                            onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
                                        />

                                        {preview ? (
                                            <div className="absolute inset-0 rounded-3xl overflow-hidden bg-white">
                                                <img src={preview} alt="Scan preview" className="w-full h-full object-cover" />
                                                {inferring && <div className="absolute inset-0 h-[30%] bg-gradient-to-b from-transparent to-sky-400/30" style={{ animation: "scan 2s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate" }}></div>}
                                            </div>
                                        ) : (
                                            <>
                                                <div className="w-14 h-14 mb-4 text-sky-500 opacity-90 mx-auto">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 12v9" /><path d="m8 16 4-4 4 4" /></svg>
                                                </div>
                                                <p className="font-semibold text-slate-700 text-lg">Securely drop scan here</p>
                                                <p className="text-slate-500 text-sm mt-1">or click to browse local files</p>
                                            </>
                                        )}
                                    </div>

                                    {errorMsg && <p className="text-red-600 text-sm mt-4 text-center bg-red-50 p-3 rounded-lg border border-red-200 font-medium">{errorMsg}</p>}

                                    <button
                                        className={`w-full mt-6 py-4 text-lg bg-slate-900 text-white rounded-xl font-bold shadow-lg hover:bg-slate-800 transition-all ${(!file || inferring) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        type="submit"
                                        disabled={inferring || !file}
                                    >
                                        <span>{inferring ? "Evaluating Metrics..." : "Initialize Inference"}</span>
                                    </button>
                                </form>
                                }
                            </section>

                            <section className={`bg-white rounded-[2rem] p-8 self-start border-t-4 border border-slate-200 shadow-sm ${result ? (result.predicted_class === 'Parkinson' ? 'border-t-red-500' : result.predicted_class === 'Borderline' ? 'border-t-amber-500' : 'border-t-emerald-500') : 'border-t-transparent'} transition-all duration-500`}>
                                <div className="flex items-center gap-3 mb-8 pb-4 border-b border-slate-100">
                                    <div className={`w-6 h-6 ${result?.predicted_class === "Parkinson" ? "text-red-500" : result?.predicted_class === "Healthy" ? "text-emerald-500" : "text-slate-400"}`}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                                    </div>
                                    <h2 className="text-xl font-bold text-slate-800">Analytics Engine</h2>
                                </div>

                                {!result && !inferring && (
                                    <div className="text-center py-12 text-slate-400">
                                        <div className="w-10 h-10 mx-auto mb-3 opacity-50">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
                                        </div>
                                        <p>Awaiting scan input for analysis.</p>
                                    </div>
                                )}

                                {inferring && (
                                    <div className="animate-pulse text-center py-12 text-sky-600">
                                        <p className="tracking-widest uppercase text-sm font-bold">Running Neural Network...</p>
                                    </div>
                                )}

                                {result && (() => {
                                    const isParkinson  = result.predicted_class === "Parkinson";
                                    const isBorderline = result.predicted_class === "Borderline";
                                    
                                    const bgColor = isParkinson ? "bg-red-50" : isBorderline ? "bg-amber-50" : "bg-emerald-50";
                                    const borderColor = isParkinson ? "border-red-200" : isBorderline ? "border-amber-200" : "border-emerald-200";
                                    const textColor = isParkinson ? "text-red-700" : isBorderline ? "text-amber-700" : "text-emerald-700";
                                    
                                    const label = isParkinson ? "Parkinson's Detected" : isBorderline ? "Borderline — Inconclusive" : "Healthy Assessment";

                                    return (
                                        <div className="animate-scale-in">
                                            <div className={`${bgColor} ${borderColor} border rounded-3xl p-8 mb-6 flex flex-col md:flex-row justify-between items-center gap-6 shadow-sm`}>
                                                <div>
                                                    <p className={`text-xs uppercase tracking-[0.15em] mb-2 font-semibold ${textColor} opacity-80`}>Primary Classification</p>
                                                    <h3 className={`text-3xl font-black m-0 ${textColor}`}>{label}</h3>
                                                </div>
                                                <div className="text-right bg-white px-6 py-4 rounded-2xl border border-slate-200 shadow-sm">
                                                    <span className={`block text-4xl font-black ${textColor}`}>
                                                        {(result.confidence * 100).toFixed(1)}<span className="text-2xl opacity-70">%</span>
                                                    </span>
                                                    <span className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mt-1">Confidence Score</span>
                                                </div>
                                            </div>

                                            {isBorderline && (
                                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 leading-relaxed mb-6 font-medium">
                                                    ⚠️ <strong className="text-amber-900">Borderline result</strong> — your drawing showed some patterns but didn't clearly indicate Parkinson's. This does not mean you are ill. Please retake the test or speak to your doctor.
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </section>

                            {/* ── Kinematic Analysis Panel ─────────────────────── */}
                            {kinematicData && (
                                <div className="col-span-1 md:col-span-2">
                                    <DrawingAnalytics data={kinematicData} />
                                </div>
                            )}
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
