import Link from "next/link";
import React from "react";

export default function Home() {
    return (
        <div className="relative min-h-screen overflow-hidden flex flex-col bg-slate-50">
            {/* Clean Medical Background FX */}
            <div className="medical-grid" />

            {/* Navigation Bar */}
            <nav className="relative z-50 flex items-center justify-between px-8 py-6 w-full max-w-7xl mx-auto animate-fade-in">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-md">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-6 h-6">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </div>
                    <span className="text-xl font-bold tracking-wide text-slate-800">Neuro<span className="text-sky-600">Trace</span></span>
                </div>
                <div className="hidden md:flex gap-4">
                    <Link href="/login" className="px-6 py-2.5 rounded-lg text-slate-600 hover:text-sky-600 font-medium transition-colors">
                        Sign In
                    </Link>
                    <Link href="/register" className="px-6 py-2.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium transition-all shadow-sm">
                        Get Started
                    </Link>
                </div>
            </nav>

            {/* Main Hero Section */}
            <main className="flex-1 flex flex-col items-center justify-center text-center px-6 relative z-10 w-full max-w-5xl mx-auto mt-12 md:mt-0">
                <div className="animate-slide-up">
                    <div className="badge-pill mb-8 shadow-sm">
                        <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse mr-2"></span>
                        NeuroVision AI Engine v2.0
                    </div>
                </div>

                <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-slate-900 mb-6 animate-slide-up delay-100 leading-tight">
                    Next-Generation <br className="hidden md:block" />
                    <span className="text-sky-600">Diagnostic Platform</span>
                </h1>

                <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto mb-10 leading-relaxed animate-slide-up delay-200">
                    Empowering clinicians with real-time kinematic analysis and state-of-the-art PyTorch neural networks for early-stage Parkinson's detection.
                </p>

                <div className="flex flex-col sm:flex-row gap-5 justify-center animate-slide-up delay-300">
                    <Link href="/register" className="action-btn text-lg py-4 px-8 shadow-lg">
                        Start Diagnostic Scan
                        <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                    </Link>
                    <Link href="/login" className="action-btn-outline text-lg py-4 px-8">
                        Doctor Portal Access
                    </Link>
                </div>

                {/* Stat Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-24 w-full animate-slide-up" style={{ animationDelay: '400ms' }}>
                    {[
                        { label: "Clinical Accuracy", value: "99.59%", desc: "Validated on proprietary dataset" },
                        { label: "Analysis Time", value: "< 2s", desc: "Real-time edge inference" },
                        { label: "Data Points", value: "10k+", desc: "Kinematic micro-tremor tracking" }
                    ].map((stat, i) => (
                        <div key={i} className="glass-panel p-6 flex flex-col items-center text-center transform hover:-translate-y-1 transition-all duration-300 cursor-default">
                            <h3 className="text-3xl font-black text-sky-600 mb-2">{stat.value}</h3>
                            <p className="text-slate-800 font-semibold text-lg">{stat.label}</p>
                            <p className="text-slate-500 text-sm mt-2">{stat.desc}</p>
                        </div>
                    ))}
                </div>

                <p className="mt-16 pb-8 text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase animate-fade-in" style={{ animationDelay: '600ms' }}>
                    For Research Use Only · Not for clinical diagnosis
                </p>
            </main>
        </div>
    );
}
