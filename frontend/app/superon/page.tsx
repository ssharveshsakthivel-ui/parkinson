"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Profile = {
    id: string;
    full_name: string | null;
};

export default function AdminPortal() {
    const router = useRouter();
    const [adminEmail, setAdminEmail] = useState("");
    const [adminName, setAdminName] = useState("");
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);

    // Data States
    const [doctors, setDoctors] = useState<Profile[]>([]);
    const [patients, setPatients] = useState<Profile[]>([]);

    // New Doctor Form State
    const [newDocEmail, setNewDocEmail] = useState("");
    const [newDocPassword, setNewDocPassword] = useState("");
    const [newDocName, setNewDocName] = useState("");
    const [creating, setCreating] = useState(false);
    const [deletingDoctorId, setDeletingDoctorId] = useState<string | null>(null);
    const [msg, setMsg] = useState("");

    useEffect(() => {
        const initAdmin = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) {
                    router.push("/login?role=doctor");
                    return;
                }

                const { data: profile, error: profileError } = await supabase
                    .from("profiles")
                    .select("role, full_name")
                    .eq("id", session.user.id)
                    .maybeSingle();

                const role = profile?.role || session.user.user_metadata?.role || "patient";

                if (role !== "admin") {
                    router.push("/"); // Kick non-admins out silently
                    return;
                }

                setSession(session);
                setAdminEmail(session.user.email || "");
                setAdminName(profile?.full_name || session.user.user_metadata?.full_name || session.user.email || "");
                setIsAdmin(true);
                fetchUsers();
            } catch {
                router.push("/");
            } finally {
                setLoading(false);
            }
        };
        initAdmin();
    }, [router]);

    const fetchUsers = async () => {
        const { data: docs } = await supabase.from("profiles").select("id, full_name").eq("role", "doctor");
        const { data: pats } = await supabase.from("profiles").select("id, full_name").eq("role", "patient");
        if (docs) setDoctors(docs);
        if (pats) setPatients(pats);
    };

    const handleCreateDoctor = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);
        setMsg("");

        try {
            if (!session?.access_token) {
                throw new Error("Admin session missing. Re-authenticate and try again.");
            }

            const response = await fetch("/api/admin/create-doctor", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    email: newDocEmail,
                    password: newDocPassword,
                    fullName: newDocName
                })
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.error || "Failed to create doctor account.");
            }

            setMsg("Doctor created successfully! Check table below.");
            setNewDocEmail("");
            setNewDocPassword("");
            setNewDocName("");
            fetchUsers();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error while creating doctor.";
            setMsg(`Error: ${message}`);
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteDoctor = async (doctorId: string, doctorName?: string | null) => {
        const confirmed = window.confirm(`Delete doctor ${doctorName || doctorId}? This action cannot be undone.`);
        if (!confirmed) return;

        if (!session?.access_token) {
            setMsg("Error: Admin session missing. Re-authenticate and try again.");
            return;
        }

        setDeletingDoctorId(doctorId);
        setMsg("");
        try {
            const response = await fetch("/api/admin/delete-doctor", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ doctorId })
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.error || "Failed to delete doctor.");
            }

            if (payload?.warning) {
                setMsg(`Warning: ${payload.warning}`);
            } else {
                setMsg("Doctor deleted successfully.");
            }
            fetchUsers();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error while deleting doctor.";
            setMsg(`Error: ${message}`);
        } finally {
            setDeletingDoctorId(null);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push("/");
    };

    if (loading) return <div style={{ color: "white", textAlign: "center", marginTop: "20vh" }}>Verifying Admin Clearance...</div>;
    if (!isAdmin) return null;

    return (
        <>
            <div className="space-dust"></div>
            <div className="glass-grid"></div>

            <nav className="top-nav">
                <div className="nav-brand">
                    NeuroTrace <span className="badge-pill" style={{ padding: "2px 10px", fontSize: "0.7rem", color: "#fca5a5", borderColor: "rgba(252,165,165,0.3)", background: "rgba(252,165,165,0.1)" }}>Superon Admin</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                    <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.85rem" }}>{adminName || adminEmail}</span>
                    <button onClick={handleLogout} className="action-btn-outline" style={{ padding: "8px 16px" }}>Terminate Session</button>
                </div>
            </nav>

            <div className="app-container" style={{ paddingTop: "2rem" }}>
                <header style={{ marginBottom: "2rem" }}>
                    <h1 className="hero-title" style={{ fontSize: "2rem" }}>Superon <span className="text-gradient">Command Center</span></h1>
                    <p className="hero-subtitle" style={{ fontSize: "1rem" }}>System access level: Maximum. Manage registered medical personnel and patients.</p>
                </header>

                <main style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "30px" }}>

                    <section className="glass-panel" style={{ padding: "30px" }}>
                        <h2 style={{ fontSize: "1.2rem", fontWeight: 600, color: "white", marginBottom: "20px" }}>Authorize New Doctor</h2>
                        <form onSubmit={handleCreateDoctor} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                            <input
                                type="text"
                                value={newDocName} onChange={e => setNewDocName(e.target.value)}
                                placeholder="Dr. Full Name" required
                                style={{ padding: "12px 16px", borderRadius: "12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                            />
                            <input
                                type="email"
                                value={newDocEmail} onChange={e => setNewDocEmail(e.target.value)}
                                placeholder="Official Email Address" required
                                style={{ padding: "12px 16px", borderRadius: "12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                            />
                            <input
                                type="password"
                                value={newDocPassword} onChange={e => setNewDocPassword(e.target.value)}
                                placeholder="Secure Password" required
                                style={{ padding: "12px 16px", borderRadius: "12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                            />
                            {msg && <p style={{ fontSize: "0.9rem", color: msg.startsWith("Error") ? "#fca5a5" : "#6ee7b7" }}>{msg}</p>}
                            <button className="action-btn" type="submit" disabled={creating} style={{ opacity: creating ? 0.6 : 1 }}>
                                {creating ? "Provisioning..." : "Provision Doctor Account"}
                            </button>
                        </form>
                    </section>

                    <section className="glass-panel" style={{ padding: "30px", maxHeight: "60vh", overflowY: "auto" }}>
                        <h2 style={{ fontSize: "1.2rem", fontWeight: 600, color: "white", marginBottom: "20px" }}>System Roster</h2>

                        <h3 style={{ color: "#818cf8", fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "10px" }}>Authorized Doctors</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "30px" }}>
                            {doctors.map(d => (
                                <div key={d.id} style={{ padding: "12px", background: "rgba(0,0,0,0.3)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                                    <div>
                                        <p style={{ color: "white", fontWeight: 500 }}>{d.full_name || "Unnamed Doctor"}</p>
                                        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem" }}>ID: {d.id}</p>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteDoctor(d.id, d.full_name)}
                                        className="action-btn-outline"
                                        disabled={deletingDoctorId === d.id}
                                        style={{ padding: "6px 10px", fontSize: "0.8rem", color: "#fca5a5", borderColor: "rgba(252,165,165,0.4)", opacity: deletingDoctorId === d.id ? 0.6 : 1 }}
                                    >
                                        {deletingDoctorId === d.id ? "Deleting..." : "Delete"}
                                    </button>
                                </div>
                            ))}
                            {doctors.length === 0 && <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.9rem" }}>No doctors registered.</p>}
                        </div>

                        <h3 style={{ color: "#34d399", fontSize: "0.9rem", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "10px" }}>Registered Patients</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            {patients.map(p => (
                                <div key={p.id} style={{ padding: "12px", background: "rgba(0,0,0,0.3)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                                    <p style={{ color: "white", fontWeight: 500 }}>{p.full_name || "Unnamed Patient"}</p>
                                    <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem" }}>ID: {p.id}</p>
                                </div>
                            ))}
                            {patients.length === 0 && <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.9rem" }}>No patients registered.</p>}
                        </div>
                    </section>

                </main>
            </div>
        </>
    );
}
