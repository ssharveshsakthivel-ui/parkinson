import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rglnzkvkubmdkzydosdb.supabase.co";
const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    "sb_publishable_GbcxEI4te1bUNquuzvCVLg_mBvqSHr7";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getBearerToken(request: NextRequest): string | null {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }
    return authHeader.slice("Bearer ".length).trim();
}

export async function POST(request: NextRequest) {
    const token = getBearerToken(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized: missing bearer token." }, { status: 401 });
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
    const authedClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    });
    const privilegedClient = supabaseServiceKey
        ? createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        : authedClient;

    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData?.user) {
        return NextResponse.json({ error: "Unauthorized: invalid token." }, { status: 401 });
    }

    const { data: adminProfile, error: adminError } = await privilegedClient
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();

    if (adminError || adminProfile?.role !== "admin") {
        return NextResponse.json({ error: "Forbidden: admin access required." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const doctorId = body?.doctorId?.trim();
    if (!doctorId) {
        return NextResponse.json({ error: "Missing doctorId." }, { status: 400 });
    }

    const { data: doctorProfile, error: doctorError } = await privilegedClient
        .from("profiles")
        .select("id, role, full_name")
        .eq("id", doctorId)
        .maybeSingle();

    if (doctorError || !doctorProfile) {
        return NextResponse.json({ error: "Doctor not found." }, { status: 404 });
    }

    if (doctorProfile.role !== "doctor") {
        return NextResponse.json({ error: "Selected user is not a doctor." }, { status: 400 });
    }

    let warning: string | null = null;
    if (supabaseServiceKey) {
        const { error: deleteError } = await privilegedClient.auth.admin.deleteUser(doctorId);
        if (deleteError) {
            return NextResponse.json({ error: deleteError.message || "Failed to delete doctor account." }, { status: 400 });
        }
    } else {
        // Fallback when service role key is unavailable: remove profile access only.
        const { error: deleteProfileError } = await privilegedClient
            .from("profiles")
            .delete()
            .eq("id", doctorId)
            .eq("role", "doctor");

        if (deleteProfileError) {
            return NextResponse.json({ error: deleteProfileError.message || "Failed to delete doctor profile." }, { status: 400 });
        }
        warning = "Doctor profile deleted. Auth record remains because SUPABASE_SERVICE_ROLE_KEY is not set.";
    }

    return NextResponse.json({
        ok: true,
        deletedDoctorId: doctorId,
        warning
    });
}
