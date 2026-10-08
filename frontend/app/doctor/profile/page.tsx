"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type DoctorProfileForm = {
    full_name: string;
    contact_number: string;
    address: string;
    gender: string;
};

const EMPTY_FORM: DoctorProfileForm = {
    full_name: "",
    contact_number: "",
    address: "",
    gender: "",
};

export default function DoctorProfilePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<DoctorProfileForm>(EMPTY_FORM);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    useEffect(() => {
        const loadProfile = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) {
                    router.push("/login?role=doctor");
                    return;
                }

                const { data: roleData, error: roleError } = await supabase
                    .from("profiles")
                    .select("role")
                    .eq("id", session.user.id)
                    .maybeSingle();

                if (roleError || roleData?.role !== "doctor") {
                    router.push("/login?role=doctor");
                    return;
                }

                const { data: profileData, error: profileError } = await supabase
                    .from("profiles")
                    .select("full_name, contact_number, address, gender")
                    .eq("id", session.user.id)
                    .maybeSingle();

                if (profileError || !profileData) {
                    throw new Error("Could not load profile details.");
                }

                setForm({
                    full_name: profileData.full_name || "",
                    contact_number: profileData.contact_number || "",
                    address: profileData.address || "",
                    gender: profileData.gender || "",
                });
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Failed to load profile.");
            } finally {
                setLoading(false);
            }
        };

        loadProfile();
    }, [router]);

    const updateField = (key: keyof DoctorProfileForm, value: string) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        setMessage("");

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error("Session expired. Please login again.");

            const { error: updateError } = await supabase
                .from("profiles")
                .update({
                    full_name: form.full_name.trim(),
                    contact_number: form.contact_number.trim() || null,
                    address: form.address.trim() || null,
                    gender: form.gender || null,
                })
                .eq("id", session.user.id);

            if (updateError) throw updateError;
            setMessage("Provider profile updated successfully.");
            
            setTimeout(() => setMessage(""), 3000);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Could not update profile.");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center text-slate-500 bg-[#F8FAFC]">Loading provider terminal...</div>;
    }

    return (
        <div className="flex flex-col min-h-screen bg-[#F8FAFC] text-slate-800 pb-24 font-sans">
            
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 z-30 p-4 flex justify-between items-center shadow-sm">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.push("/doctor/dashboard")} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-2 font-semibold text-slate-700 text-sm">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        Back to Hub
                    </button>
                    <span className="font-bold text-slate-800 tracking-tight">NeuroTrace</span>
                </div>
            </div>

            <div className="max-w-3xl mx-auto w-full pt-12 px-6 animate-fade-in">
                <div className="mb-10 text-center">
                    <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-indigo-700 text-white rounded-full flex items-center justify-center text-3xl font-bold mx-auto mb-4 shadow-lg shadow-indigo-200">
                        {form.full_name ? form.full_name.charAt(0).toUpperCase() : "D"}
                    </div>
                    <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">
                        Provider <span className="text-indigo-600">Profile</span>
                    </h1>
                    <p className="text-slate-500 mt-2">
                        Manage your clinical directory presence and contact information.
                    </p>
                </div>

                <form onSubmit={handleSave} className="space-y-6">
                    
                    <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-500"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            Directory Information
                        </h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Full Name (including titles)</label>
                                <input
                                    value={form.full_name}
                                    onChange={(e) => updateField("full_name", e.target.value)}
                                    placeholder="e.g. Dr. Jane Smith, MD"
                                    required
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800"
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Contact Number</label>
                                <input
                                    value={form.contact_number}
                                    onChange={(e) => updateField("contact_number", e.target.value)}
                                    placeholder="Clinic or Direct Line"
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800"
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Gender</label>
                                <select
                                    value={form.gender}
                                    onChange={(e) => updateField("gender", e.target.value)}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800 cursor-pointer"
                                >
                                    <option value="">Select</option>
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>

                            <div className="space-y-2 md:col-span-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Clinic Address / Location</label>
                                <textarea
                                    value={form.address}
                                    onChange={(e) => updateField("address", e.target.value)}
                                    placeholder="Enter primary practice location"
                                    rows={3}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800 resize-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col items-center gap-4 mt-8">
                        {error && <div className="text-red-600 bg-red-50 px-4 py-3 rounded-xl border border-red-200 w-full text-center text-sm font-semibold">{error}</div>}
                        {message && <div className="text-emerald-700 bg-emerald-50 px-4 py-3 rounded-xl border border-emerald-200 w-full text-center text-sm font-semibold">{message}</div>}
                        
                        <button 
                            type="submit" 
                            disabled={saving} 
                            className={`w-full py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-lg shadow-lg shadow-slate-900/20 transition-all ${saving ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                            {saving ? "Updating Directory..." : "Save Provider Profile"}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}
