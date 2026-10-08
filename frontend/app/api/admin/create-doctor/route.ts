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

function isDuplicateEmailError(message?: string | null) {
    if (!message) return false;
    return /already registered|already exists|duplicate|email.*exists/i.test(message);
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

    const { data: adminProfile, error: profileError } = await privilegedClient
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();

    if (profileError || adminProfile?.role !== "admin") {
        return NextResponse.json({ error: "Forbidden: admin access required." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const email = body?.email?.trim();
    const password = body?.password;
    const fullName = body?.fullName?.trim();

    if (!email || !password || !fullName) {
        return NextResponse.json(
            { error: "Missing required fields: email, password, fullName." },
            { status: 400 }
        );
    }

    if (typeof password !== "string" || password.length < 6) {
        return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }

    let doctorId: string | null = null;
    let warning: string | null = null;

    if (supabaseServiceKey) {
        const { data: existingUsers, error: listUsersError } = await privilegedClient.auth.admin.listUsers();
        if (!listUsersError) {
            const hasEmail = existingUsers.users.some((u) => (u.email || "").toLowerCase() === email.toLowerCase());
            if (hasEmail) {
                return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
            }
        }

        const { data: createdDoctor, error: createError } = await privilegedClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                role: "doctor",
                full_name: fullName
            }
        });

        if (createError || !createdDoctor.user?.id) {
            if (isDuplicateEmailError(createError?.message)) {
                return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
            }
            return NextResponse.json({ error: createError?.message || "Failed to create doctor user." }, { status: 400 });
        }
        doctorId = createdDoctor.user.id;
    } else {
        // Fallback mode when service key is unavailable:
        // create via standard signUp from server-side context.
        const { data: signUpData, error: signUpError } = await authClient.auth.signUp({
            email,
            password,
            options: {
                data: {
                    role: "doctor",
                    full_name: fullName
                }
            }
        });

        if (signUpError || !signUpData.user?.id) {
            if (isDuplicateEmailError(signUpError?.message)) {
                return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
            }
            return NextResponse.json({ error: signUpError?.message || "Failed to create doctor user." }, { status: 400 });
        }

        const identities = signUpData.user.identities || [];
        if (identities.length === 0) {
            return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
        }
        doctorId = signUpData.user.id;
    }

    const { error: profileUpsertError } = await privilegedClient.from("profiles").upsert(
        {
            id: doctorId,
            role: "doctor",
            full_name: fullName
        },
        { onConflict: "id" }
    );

    if (profileUpsertError) {
        if (supabaseServiceKey) {
            return NextResponse.json(
                { error: "Doctor auth account created, but profile sync failed. Please check profiles table." },
                { status: 500 }
            );
        }
        warning = "Doctor account created, but profile sync could not be fully verified without service-role key.";
    }

    return NextResponse.json({
        ok: true,
        doctor: {
            id: doctorId,
            email
        },
        warning
    });
}
