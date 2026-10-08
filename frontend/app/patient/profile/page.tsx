"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type ProfileForm = {
    full_name: string;
    age: string;
    gender: string;
    contact_number: string;
    address: string;
    blood_type: string;
    emergency_contact_name: string;
    emergency_contact_number: string;
    primary_care_physician: string;
    allergies: string;
    current_medications: string;
    neurological_condition: boolean;
    family_history: boolean;
    handedness: string;
    symptom_onset_date: string;
};

const EMPTY_FORM: ProfileForm = {
    full_name: "",
    age: "",
    gender: "",
    contact_number: "",
    address: "",
    blood_type: "",
    emergency_contact_name: "",
    emergency_contact_number: "",
    primary_care_physician: "",
    allergies: "",
    current_medications: "",
    neurological_condition: false,
    family_history: false,
    handedness: "",
    symptom_onset_date: "",
};

export default function PatientProfilePage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    useEffect(() => {
        const loadProfile = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) {
                    router.push("/login?role=patient");
                    return;
                }

                const { data: roleData, error: roleError } = await supabase
                    .from("profiles")
                    .select("role")
                    .eq("id", session.user.id)
                    .maybeSingle();

                if (roleError || roleData?.role !== "patient") {
                    router.push("/login?role=patient");
                    return;
                }

                const { data: profileData, error: profileError } = await supabase
                    .from("profiles")
                    .select(`
                        full_name, age, gender, contact_number, address,
                        blood_type, emergency_contact_name, emergency_contact_number,
                        primary_care_physician, allergies, current_medications,
                        neurological_condition, family_history, handedness, symptom_onset_date
                    `)
                    .eq("id", session.user.id)
                    .maybeSingle();

                if (profileError && profileError.code !== 'PGRST116') {
                    console.error("Profile load error:", profileError);
                    // Don't throw for empty profiles, just let the user create one
                }

                if (!profileData) {
                    console.warn("No profile found for this user.");
                    setLoading(false);
                    return; // leave form as EMPTY_FORM
                }

                setForm({
                    full_name: profileData.full_name || "",
                    age: profileData.age ? String(profileData.age) : "",
                    gender: profileData.gender || "",
                    contact_number: profileData.contact_number || "",
                    address: profileData.address || "",
                    blood_type: profileData.blood_type || "",
                    emergency_contact_name: profileData.emergency_contact_name || "",
                    emergency_contact_number: profileData.emergency_contact_number || "",
                    primary_care_physician: profileData.primary_care_physician || "",
                    allergies: profileData.allergies || "",
                    current_medications: profileData.current_medications || "",
                    neurological_condition: Boolean(profileData.neurological_condition),
                    family_history: Boolean(profileData.family_history),
                    handedness: profileData.handedness || "",
                    symptom_onset_date: profileData.symptom_onset_date || "",
                });
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Failed to load profile.");
            } finally {
                setLoading(false);
            }
        };

        loadProfile();
    }, [router]);

    const updateField = (key: keyof ProfileForm, value: string | boolean) => {
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
                    age: form.age ? Number(form.age) : null,
                    gender: form.gender || null,
                    contact_number: form.contact_number.trim(),
                    address: form.address.trim(),
                    blood_type: form.blood_type.trim() || null,
                    emergency_contact_name: form.emergency_contact_name.trim() || null,
                    emergency_contact_number: form.emergency_contact_number.trim() || null,
                    primary_care_physician: form.primary_care_physician.trim() || null,
                    allergies: form.allergies.trim() || null,
                    current_medications: form.current_medications.trim() || null,
                    neurological_condition: form.neurological_condition,
                    family_history: form.family_history,
                    handedness: form.handedness || null,
                    symptom_onset_date: form.symptom_onset_date || null,
                })
                .eq("id", session.user.id);

            if (updateError) throw updateError;
            setMessage("Profile updated successfully.");
            
            // Auto hide message after 3 seconds
            setTimeout(() => setMessage(""), 3000);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Could not update profile.");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center text-slate-500 bg-[#F8FAFC]">Loading profile...</div>;
    }

    return (
        <div className="flex flex-col min-h-screen bg-[#F8FAFC] text-slate-800 pb-24 font-sans">
            
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 z-30 p-4 flex justify-between items-center shadow-sm">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.push("/patient/dashboard")} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-2 font-semibold text-slate-700 text-sm">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        Back to Dashboard
                    </button>
                    <span className="font-bold text-slate-800 tracking-tight">NeuroTrace</span>
                </div>
            </div>

            <div className="max-w-3xl mx-auto w-full pt-12 px-6 animate-fade-in">
                <div className="mb-10 text-center">
                    <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-indigo-700 text-white rounded-full flex items-center justify-center text-3xl font-bold mx-auto mb-4 shadow-lg shadow-indigo-200">
                        {form.full_name ? form.full_name.charAt(0).toUpperCase() : "P"}
                    </div>
                    <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">
                        Patient <span className="text-indigo-600">Profile</span>
                    </h1>
                    <p className="text-slate-500 mt-2">
                        Manage your clinical information and medical history securely.
                    </p>
                </div>

                <form onSubmit={handleSave} className="space-y-6">
                    
                    {/* Section: Personal Information */}
                    <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-500"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            Personal Information
                        </h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Full Name</label>
                                <input
                                    value={form.full_name}
                                    onChange={(e) => updateField("full_name", e.target.value)}
                                    placeholder="Enter your full name"
                                    required
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Age</label>
                                    <input
                                        type="number" min={1} max={120}
                                        value={form.age}
                                        onChange={(e) => updateField("age", e.target.value)}
                                        placeholder="e.g. 65"
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
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Residential Address</label>
                                <textarea
                                    value={form.address}
                                    onChange={(e) => updateField("address", e.target.value)}
                                    placeholder="Enter your full residential address"
                                    rows={2}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800 resize-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Section: Contact & Emergency */}
                    <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-500"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                            Contact & Emergency
                        </h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Personal Phone Number</label>
                                <input
                                    value={form.contact_number}
                                    onChange={(e) => updateField("contact_number", e.target.value)}
                                    placeholder="e.g. +1 (555) 000-0000"
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Emergency Contact Name</label>
                                <input
                                    value={form.emergency_contact_name}
                                    onChange={(e) => updateField("emergency_contact_name", e.target.value)}
                                    placeholder="Full name"
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Emergency Contact Phone</label>
                                <input
                                    value={form.emergency_contact_number}
                                    onChange={(e) => updateField("emergency_contact_number", e.target.value)}
                                    placeholder="Phone number"
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Section: Medical History */}
                    <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
                            Medical History
                        </h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Blood Type</label>
                                <select
                                    value={form.blood_type}
                                    onChange={(e) => updateField("blood_type", e.target.value)}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800 cursor-pointer"
                                >
                                    <option value="">Select</option>
                                    <option value="A+">A+</option>
                                    <option value="A-">A-</option>
                                    <option value="B+">B+</option>
                                    <option value="B-">B-</option>
                                    <option value="AB+">AB+</option>
                                    <option value="AB-">AB-</option>
                                    <option value="O+">O+</option>
                                    <option value="O-">O-</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Primary Care Physician</label>
                                <input
                                    value={form.primary_care_physician}
                                    onChange={(e) => updateField("primary_care_physician", e.target.value)}
                                    placeholder="Dr. Name"
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800"
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Allergies</label>
                                <input
                                    value={form.allergies}
                                    onChange={(e) => updateField("allergies", e.target.value)}
                                    placeholder="List any known allergies or 'None'"
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800"
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Current Medications</label>
                                <textarea
                                    value={form.current_medications}
                                    onChange={(e) => updateField("current_medications", e.target.value)}
                                    placeholder="List current medications and dosages"
                                    rows={2}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800 resize-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Section: Neurological Profile */}
                    <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm">
                        <h2 className="text-lg font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-500"><path d="M12 2a9 9 0 0 0-9 9c0 4.97 4.03 9 9 9h3v-2h-3a7 7 0 0 1-7-7c0-3.87 3.13-7 7-7s7 3.13 7 7v1.5a2.5 2.5 0 0 1-5 0V11"/><circle cx="12" cy="11" r="3"/></svg>
                            Neurological Profile
                        </h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Prior Neurological Condition</label>
                                <select
                                    value={form.neurological_condition ? "yes" : "no"}
                                    onChange={(e) => updateField("neurological_condition", e.target.value === "yes")}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800 cursor-pointer"
                                >
                                    <option value="no">No</option>
                                    <option value="yes">Yes</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Family History of Parkinson's</label>
                                <select
                                    value={form.family_history ? "yes" : "no"}
                                    onChange={(e) => updateField("family_history", e.target.value === "yes")}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800 cursor-pointer"
                                >
                                    <option value="no">No</option>
                                    <option value="yes">Yes</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Dominant Hand</label>
                                <select
                                    value={form.handedness}
                                    onChange={(e) => updateField("handedness", e.target.value)}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800 cursor-pointer"
                                >
                                    <option value="">Select</option>
                                    <option value="Right">Right-handed</option>
                                    <option value="Left">Left-handed</option>
                                    <option value="Ambidextrous">Ambidextrous</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Symptom Onset Date (Optional)</label>
                                <input
                                    type="date"
                                    value={form.symptom_onset_date}
                                    onChange={(e) => updateField("symptom_onset_date", e.target.value)}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-slate-800"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex flex-col items-center gap-4 mt-8">
                        {error && <div className="text-red-600 bg-red-50 px-4 py-3 rounded-xl border border-red-200 w-full text-center text-sm font-semibold">{error}</div>}
                        {message && <div className="text-emerald-700 bg-emerald-50 px-4 py-3 rounded-xl border border-emerald-200 w-full text-center text-sm font-semibold">{message}</div>}
                        
                        <button 
                            type="submit" 
                            disabled={saving} 
                            className={`w-full py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-lg shadow-lg shadow-slate-900/20 transition-all ${saving ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                            {saving ? "Saving Profile..." : "Save Medical Profile"}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}
