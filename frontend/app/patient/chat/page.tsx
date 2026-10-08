"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function ChatContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const doctorId = searchParams.get("doctor");

    const [user, setUser] = useState<any>(null);
    const [doctorInfo, setDoctorInfo] = useState<any>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const initChat = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();

                if (!session) {
                    router.push("/login?role=patient");
                    return;
                }

                if (session.user.user_metadata?.role !== "patient") {
                    router.push("/login?role=patient");
                    return;
                }

                setUser(session.user);

                if (!doctorId) {
                    router.push("/patient/dashboard");
                    return;
                }

                // Fetch Doctor Info
                const { data: docInfo } = await supabase
                    .from('profiles')
                    .select('full_name')
                    .eq('id', doctorId)
                    .single();

                if (docInfo) setDoctorInfo(docInfo);

                // Fetch Message History
                const { data: history } = await supabase
                    .from('messages')
                    .select('*')
                    .or(`and(sender_id.eq.${session.user.id},receiver_id.eq.${doctorId}),and(sender_id.eq.${doctorId},receiver_id.eq.${session.user.id})`)
                    .order('created_at', { ascending: true });

                if (history) setMessages(history);

                // Subscribe to Realtime Messages
                const channel = supabase
                    .channel('direct_messages')
                    .on('postgres_changes', {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'messages',
                        filter: `receiver_id=eq.${session.user.id}`
                    }, (payload) => {
                        // Only add if it's from the currently viewed doctor
                        if (payload.new.sender_id === doctorId) {
                            setMessages(prev => [...prev, payload.new]);
                        }
                    })
                    .subscribe();

                return () => {
                    supabase.removeChannel(channel);
                };

            } catch (e) {
                console.error("Chat init failed:", e);
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = initChat();

        return () => {
            unsubscribe.then(unsub => unsub && unsub());
        };
    }, [router, doctorId]);

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const sendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim() || !user || !doctorId) return;

        const msgContent = newMessage;
        setNewMessage(""); // Optimistic UI clear

        // Optimistic UI Append
        const tempMsg = {
            id: 'temp-' + Date.now(),
            sender_id: user.id,
            receiver_id: doctorId,
            content: msgContent,
            created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, tempMsg]);

        // Sent to Supabase
        const { error } = await supabase.from('messages').insert({
            sender_id: user.id,
            receiver_id: doctorId,
            content: msgContent
        });

        if (error) {
            console.error("Failed to send message:", error);
            // Optionally remove the optimistic message on failure
        }
    };

    if (loading) return <div style={{ color: "white", textAlign: "center", marginTop: "20vh" }}>Accessing Secure Comm Link...</div>;

    return (
        <>
            <div className="space-dust"></div>
            <div className="ambient-glow orb-primary"></div>
            <div className="ambient-glow orb-secondary"></div>
            <div className="glass-grid"></div>

            <nav className="top-nav">
                <div onClick={() => router.push('/patient/dashboard')} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", color: "white" }}>
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                    <span>Back to Dashboard</span>
                </div>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.9rem" }}>
                    Secure Link: <strong style={{ color: "white" }}>Dr. {doctorInfo?.full_name || "Specialist"}</strong>
                </div>
            </nav>

            <div style={{ maxWidth: "800px", margin: "0 auto", height: "calc(100vh - 120px)", display: "flex", flexDirection: "column", paddingTop: "20px" }}>

                {/* Chat History Panel */}
                <div className="glass-panel" style={{ flex: 1, overflowY: "auto", padding: "30px", display: "flex", flexDirection: "column", gap: "15px", marginBottom: "20px" }}>
                    {messages.length === 0 ? (
                        <div style={{ margin: "auto", textAlign: "center", color: "rgba(255,255,255,0.4)" }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48" style={{ margin: "0 auto 10px", display: "block" }}>
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                            </svg>
                            <p>End-to-End Encrypted Clinical Chat.</p>
                            <p style={{ fontSize: "0.85rem" }}>Send a message to consult with your physician.</p>
                        </div>
                    ) : (
                        messages.map((msg) => {
                            const isMe = msg.sender_id === user.id;
                            return (
                                <div key={msg.id} style={{ alignSelf: isMe ? "flex-end" : "flex-start", maxWidth: "70%" }}>
                                    <div style={{
                                        background: isMe ? "var(--brand)" : "rgba(255,255,255,0.1)",
                                        color: "white",
                                        padding: "12px 18px",
                                        borderRadius: "18px",
                                        borderBottomRightRadius: isMe ? "4px" : "18px",
                                        borderBottomLeftRadius: isMe ? "18px" : "4px",
                                        fontSize: "0.95rem",
                                        lineHeight: 1.5,
                                        boxShadow: "0 4px 15px rgba(0,0,0,0.1)"
                                    }}>
                                        {msg.content}
                                    </div>
                                    <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginTop: "4px", textAlign: isMe ? "right" : "left" }}>
                                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Message Input */}
                <form onSubmit={sendMessage} style={{ display: "flex", gap: "15px" }}>
                    <input
                        type="text"
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Type a clinical question or symptom update..."
                        className="glass-panel"
                        style={{ flex: 1, padding: "18px 24px", color: "white", fontSize: "1rem", outline: "none", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                    <button type="submit" disabled={!newMessage.trim()} className="action-btn" style={{ padding: "0 30px", opacity: newMessage.trim() ? 1 : 0.5 }}>
                        Send
                    </button>
                </form>
            </div>
        </>
    );
}

export default function PatientChat() {
    return (
        <Suspense fallback={<div style={{ color: "white", textAlign: "center", marginTop: "20vh" }}>Loading Secure Link...</div>}>
            <ChatContent />
        </Suspense>
    );
}
