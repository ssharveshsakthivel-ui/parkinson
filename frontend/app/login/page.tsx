"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type UserRole = "admin" | "doctor" | "patient";
const VALID_ROLES: UserRole[] = ["admin", "doctor", "patient"];

export default function Login() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const resolveRole = async (userId: string, fallback: UserRole): Promise<UserRole> => {
        const { data, error } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", userId)
            .maybeSingle();

        if (error || !data?.role) return fallback;
        if (VALID_ROLES.includes(data.role as UserRole)) return data.role as UserRole;
        return fallback;
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });

            if (error) throw error;
            if (!data.user) throw new Error("No user returned.");

            const metadataRole = VALID_ROLES.includes(data.user.user_metadata?.role as UserRole)
                ? (data.user.user_metadata?.role as UserRole)
                : "patient";

            const role = await resolveRole(data.user.id, metadataRole);

            if (role === "admin") router.push("/superon");
            else if (role === "doctor") router.push("/doctor/dashboard");
            else router.push("/patient/dashboard");

        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to authenticate");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="dashboard-layout bg-slate-50 text-slate-800 min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 relative">
            <div className="medical-grid absolute inset-0 z-0 pointer-events-none"></div>

            <div className="max-w-md w-full space-y-8 z-10 animate-fade-in">
                <section className="bg-white p-10 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
                    {/* Top Accent Line */}
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-sky-400 to-sky-600"></div>

                    <div className="text-center mb-10">
                        <div className="inline-block px-3 py-1 bg-sky-50 text-sky-700 text-xs font-bold tracking-widest uppercase rounded-full border border-sky-100 mb-4">
                            NeuroTrace Clinical
                        </div>
                        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Welcome Back</h1>
                        <p className="text-slate-500 text-sm font-medium">
                            Sign in to access your secure medical dashboard
                        </p>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-center text-sm font-semibold mb-6 shadow-sm">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-1.5">
                            <label htmlFor="login-email" className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">
                                Email Address
                            </label>
                            <input
                                id="login-email"
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                required
                                className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all text-sm text-slate-800 shadow-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label htmlFor="login-password" className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">
                                Password
                            </label>
                            <input
                                id="login-password"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all text-sm text-slate-800 shadow-sm"
                            />
                        </div>

                        <button
                            id="login-submit"
                            className={`action-btn w-full py-4 text-base mt-2 shadow-md ${loading ? 'opacity-70 cursor-not-allowed' : ''}`}
                            type="submit"
                            disabled={loading}
                        >
                            <span>{loading ? "Authenticating securely..." : "Sign In"}</span>
                        </button>
                    </form>

                    <div className="mt-10 pt-6 border-t border-slate-100 text-center text-sm">
                        <p className="text-slate-500 font-medium mb-3">
                            New patient?
                        </p>
                        <a href="/register" className="text-sky-600 font-bold hover:text-sky-700 hover:underline transition-colors block mb-3">
                            Register your medical profile
                        </a>
                        <p className="text-xs text-slate-400 mt-6 bg-slate-50 py-2 px-3 rounded-lg border border-slate-100 inline-block">
                            Clinical providers are provisioned by Administration.
                        </p>
                    </div>
                </section>
            </div>
        </div>
    );
}
