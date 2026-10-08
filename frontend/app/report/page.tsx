"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function ReportContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const reportId = searchParams.get("id");

    const [report, setReport] = useState<any>(null);
    const [patient, setPatient] = useState<any>(null);
    const [doctor, setDoctor] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchReport = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) {
                    router.push("/login");
                    return;
                }

                if (!reportId) throw new Error("No report ID provided");

                // Fetch Report Data
                const { data: reportData, error: reportErr } = await supabase
                    .from('predictions_and_reports')
                    .select('*')
                    .eq('report_id', reportId)
                    .single();

                if (reportErr || !reportData) throw new Error("Report not found");
                setReport(reportData);

                // Fetch Patient Profile
                const { data: patientData } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', reportData.patient_id)
                    .single();
                if (patientData) setPatient(patientData);

                // Fetch Doctor Profile
                const { data: doctorData } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', reportData.doctor_id)
                    .single();
                if (doctorData) setDoctor(doctorData);

            } catch (e) {
                console.error("Error fetching report:", e);
            } finally {
                setLoading(false);
            }
        };

        fetchReport();
    }, [reportId, router]);

    const handlePrint = () => {
        window.print();
    };

    if (loading) return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-slate-500">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-sky-500 rounded-full animate-spin mb-4"></div>
            Accessing secure medical records...
        </div>
    );
    
    if (!report) return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <div className="bg-red-50 text-red-700 p-8 rounded-2xl border border-red-200 shadow-sm text-center">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto mb-4 opacity-80"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <h2 className="text-xl font-bold mb-2">Record Not Found</h2>
                <p className="text-sm">Error: Report could not be located in the neural ledger.</p>
            </div>
        </div>
    );

    return (
        <div className="bg-slate-50 min-h-screen print:bg-white text-slate-800">
            
            <div className="max-w-4xl mx-auto py-10 px-4 sm:px-6 relative z-10">
                {/* Navigation / Actions - Hidden while printing */}
                <div className="flex justify-between items-center mb-8 no-print">
                    <button onClick={() => router.back()} className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 font-semibold text-sm rounded-lg hover:bg-slate-50 shadow-sm transition-all">
                        &larr; Return to Dashboard
                    </button>
                    <button onClick={handlePrint} className="px-5 py-2.5 bg-sky-600 text-white font-semibold text-sm rounded-lg hover:bg-sky-700 shadow-sm transition-all flex items-center gap-2">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                        Export PDF / Print Data
                    </button>
                </div>

                {/* Printable Report Document */}
                <main className="bg-white p-10 md:p-14 border border-slate-200 rounded-2xl shadow-sm report-document relative">

                    {/* Header */}
                    <header className="flex flex-col md:flex-row justify-between items-start md:items-end border-b-2 border-slate-800 pb-6 mb-8 gap-6">
                        <div>
                            <div className="flex items-center gap-2 mb-2 text-sky-600">
                                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                                <span className="font-bold tracking-widest uppercase text-xs">NeuroTrace Clinical</span>
                            </div>
                            <h1 className="text-3xl font-black text-slate-900 m-0">Diagnostic AI Report</h1>
                            <p className="text-slate-500 text-sm mt-1">Automated Kinematic & Scan Analysis Engine</p>
                        </div>
                        <div className="text-left md:text-right text-slate-500 text-xs">
                            <p className="mb-1">Report ID: <strong className="text-slate-800">{report.report_id.split('-')[0].toUpperCase()}</strong></p>
                            <p>Generated: {new Date(report.analysis_date).toLocaleDateString()} {new Date(report.analysis_date).toLocaleTimeString()}</p>
                        </div>
                    </header>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-10">
                        {/* Patient Meta */}
                        <div>
                            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-2">Target Patient Data</h3>
                            <div className="space-y-2 text-sm text-slate-700">
                                <p><strong className="text-slate-900 inline-block w-32">Name:</strong> {patient?.full_name || "Unknown Patient"}</p>
                                <p><strong className="text-slate-900 inline-block w-32">Age / Gender:</strong> {patient?.age || "N/A"} / {patient?.gender || "N/A"}</p>
                                <p><strong className="text-slate-900 inline-block w-32">Contact:</strong> {patient?.contact_number || "N/A"}</p>
                                <p><strong className="text-slate-900 inline-block w-32">Prior Condition:</strong> {patient?.neurological_condition ? "Yes" : "No"}</p>
                                <p><strong className="text-slate-900 inline-block w-32">Family History:</strong> {patient?.family_history ? "Yes" : "No"}</p>
                            </div>
                        </div>

                        {/* Provider Meta */}
                        <div>
                            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-2">Attending Physician</h3>
                            <div className="space-y-2 text-sm text-slate-700">
                                <p><strong className="text-slate-900 inline-block w-28">Name:</strong> {doctor?.full_name || "Automated Review"}</p>
                                <p><strong className="text-slate-900 inline-block w-28">Provider ID:</strong> {doctor?.id?.split('-')[0] || "N/A"}</p>
                                <p className="mt-4 text-slate-400 font-medium italic text-xs leading-relaxed pt-2">Electronically mapped & signed by NeuroTrace AI framework.</p>
                            </div>
                        </div>
                    </div>

                    {/* Core AI Results */}
                    <section className="bg-slate-50 border border-slate-200 rounded-xl p-8 mb-10">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-sky-600 mb-6 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-sky-500"></span>
                            Convolutional Neural Network Findings
                        </h3>

                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-6">
                            <div>
                                <p className="text-slate-500 text-sm font-semibold mb-1">Primary Prediction Class</p>
                                <h2 className={`text-3xl font-black m-0 ${report.prediction_result.toLowerCase() === 'parkinson' ? 'text-red-600' : report.prediction_result.toLowerCase() === 'borderline' ? 'text-amber-600' : 'text-emerald-600'}`}>
                                    {report.prediction_result.toUpperCase()} DETECTED
                                </h2>
                            </div>
                            <div className="text-left sm:text-right bg-white px-5 py-3 rounded-xl border border-slate-200 shadow-sm">
                                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mb-1">Confidence Score Metrics</p>
                                <h2 className="text-2xl font-black text-slate-900 m-0">
                                    {(report.confidence_score * 100).toFixed(2)}%
                                </h2>
                            </div>
                        </div>

                        <div className="bg-white border border-slate-200 p-4 rounded-lg flex justify-between items-center">
                            <p className="m-0 font-bold text-slate-700 text-sm">Derived Severity Level:</p>
                            <span className={`px-4 py-1.5 rounded-md font-extrabold text-xs uppercase tracking-wide ${
                                report.severity_level === 'Higher Level' ? 'bg-red-100 text-red-700' : 
                                report.severity_level === 'Lower Level' ? 'bg-amber-100 text-amber-700' : 
                                'bg-emerald-100 text-emerald-700'
                            }`}>
                                {report.severity_level}
                            </span>
                        </div>
                    </section>

                    {/* Doctor Remarks */}
                    <section>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4 border-b border-slate-100 pb-2">Physician Clinical Notes</h3>
                        <div className="bg-white border border-slate-200 rounded-lg p-6 min-h-[100px]">
                            <p className="text-sm leading-relaxed text-slate-700 italic m-0">
                                {report.doctor_suggestions || "No additional clinical notes provided at the time of report generation."}
                            </p>
                        </div>
                    </section>

                    <footer className="mt-16 pt-6 border-t border-slate-200 text-center text-slate-400 text-xs leading-relaxed">
                        <p className="font-semibold text-slate-500">This diagnostic report was generated entirely by the NeuroTrace Convolutional Neural Network.</p>
                        <p>It is not intended to replace professional, licensed medical diagnosis. Always consult a certified neurologist.</p>
                    </footer>

                </main>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
        @media print {
          body { background: white !important; -webkit-print-color-adjust: exact; margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .report-document { box-shadow: none !important; border: none !important; padding: 0 !important; }
        }
      `}} />
        </div>
    );
}

export default function DiagnosticReport() {
    return (
        <Suspense fallback={<div style={{ color: "white", textAlign: "center", marginTop: "20vh" }}>Loading Report...</div>}>
            <ReportContent />
        </Suspense>
    );
}
