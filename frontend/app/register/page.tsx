"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Register() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Auth Fields
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    // Profile Fields
    const [fullName, setFullName] = useState("");
    const [age, setAge] = useState("");
    const [gender, setGender] = useState("");
    const [contactNumber, setContactNumber] = useState("");
    const [address, setAddress] = useState("");
    const [neuroCondition, setNeuroCondition] = useState("No");
    const [familyHistory, setFamilyHistory] = useState("No");

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            // 1. Sign up the user in Supabase Auth
            // The Postgres Trigger will automatically create the row in the 'profiles' table with the role 'patient'
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        role: "patient",
                        full_name: fullName
                    }
                }
            });

            if (authError) throw authError;

            if (!authData.user) {
                throw new Error("Registration failed - no user returned.");
            }

            // 2. Update the newly created profile with the extended medical fields
            const { error: profileError } = await supabase
                .from('profiles')
                .update({
                    age: parseInt(age),
                    gender,
                    contact_number: contactNumber,
                    address,
                    neurological_condition: neuroCondition === "Yes",
                    family_history: familyHistory === "Yes"
                })
                .eq('id', authData.user.id);

            if (profileError) {
                console.error("Profile update failed:", profileError);
            }

            // 3. Reroute to patient dashboard
            router.push("/patient/dashboard");

        } catch (err: any) {
            setError(err.message || "Registration encountered a secure error.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="dashboard-layout bg-slate-50 text-slate-800 min-h-screen relative flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <div className="medical-grid absolute inset-0 z-0 pointer-events-none"></div>

            <div className="max-w-2xl w-full space-y-8 z-10 animate-fade-in relative">
                
                <header className="text-center mb-8">
                    <div className="inline-block px-4 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-bold tracking-widest uppercase rounded-full border border-emerald-200 mb-4 shadow-sm">
                        Patient Onboarding
                    </div>
                    <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-3">
                        Create Medical <span className="text-emerald-600">Profile</span>
                    </h1>
                    <p className="text-slate-500 font-medium">Secure, private, and seamlessly connected to your provider.</p>
                </header>

                <main className="bg-white p-8 md:p-10 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden">
                    {/* Top Accent Line */}
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-400 to-emerald-600"></div>

                    <form onSubmit={handleRegister} className="space-y-6">

                        {/* Row 1: Name & Email */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Full Legal Name</label>
                                <input
                                    type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                                    placeholder="e.g. John Doe" required
                                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all text-sm text-slate-800 shadow-sm"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Email Address</label>
                                <input
                                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                                    placeholder="name@example.com" required
                                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all text-sm text-slate-800 shadow-sm"
                                />
                            </div>
                        </div>

                        {/* Row 2: Password & Contact */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Secure Password</label>
                                <input
                                    type="password" value={password} onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••" required minLength={6}
                                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all text-sm text-slate-800 shadow-sm"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Contact Number</label>
                                <input
                                    type="text" value={contactNumber} onChange={e => setContactNumber(e.target.value)}
                                    placeholder="+1 (555) 000-0000" required
                                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all text-sm text-slate-800 shadow-sm"
                                />
                            </div>
                        </div>

                        {/* Row 3: Age & Gender */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Age</label>
                                <input
                                    type="number" value={age} onChange={e => setAge(e.target.value)}
                                    placeholder="Years" required min={1} max={120}
                                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all text-sm text-slate-800 shadow-sm"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Gender</label>
                                <select
                                    value={gender} onChange={e => setGender(e.target.value)} required
                                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all text-sm text-slate-800 shadow-sm cursor-pointer"
                                >
                                    <option value="" disabled>Select Gender</option>
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                        </div>

                        {/* Row 4: Address */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Residential Address</label>
                            <input
                                type="text" value={address} onChange={e => setAddress(e.target.value)}
                                placeholder="Full Street Address" required
                                className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all text-sm text-slate-800 shadow-sm"
                            />
                        </div>

                        {/* Row 5: Medical Questionnaires */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-slate-100">
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                <label className="text-xs font-bold tracking-wider text-slate-700 block mb-2 uppercase">Any Neurological Condition?</label>
                                <select value={neuroCondition} onChange={e => setNeuroCondition(e.target.value)} className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 outline-none focus:border-emerald-500 cursor-pointer shadow-sm">
                                    <option value="No">No</option>
                                    <option value="Yes">Yes</option>
                                </select>
                            </div>

                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                <label className="text-xs font-bold tracking-wider text-slate-700 block mb-2 uppercase">Family History of Parkinson's?</label>
                                <select value={familyHistory} onChange={e => setFamilyHistory(e.target.value)} className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 outline-none focus:border-emerald-500 cursor-pointer shadow-sm">
                                    <option value="No">No</option>
                                    <option value="Yes">Yes</option>
                                </select>
                            </div>
                        </div>

                        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-center text-sm font-semibold shadow-sm">{error}</div>}

                        <button 
                            className={`w-full py-4 rounded-xl font-bold text-white text-lg transition-all shadow-md ${loading ? 'bg-emerald-400 cursor-not-allowed opacity-70' : 'bg-emerald-500 hover:bg-emerald-600 hover:-translate-y-0.5 hover:shadow-lg'}`}
                            type="submit" 
                            disabled={loading}
                        >
                            <span>{loading ? "Registering Profile..." : "Initialize Medical Profile"}</span>
                        </button>
                        
                        <div className="text-center mt-6">
                             <a href="/login" className="text-sm font-semibold text-slate-500 hover:text-emerald-600 transition-colors">
                                Already have an account? Sign in
                            </a>
                        </div>
                    </form>
                </main>
            </div>
        </div>
    );
}
