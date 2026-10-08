const resolveApiUrl = () => {
    const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");
    const isLocalHost = (host: string) => host === "localhost" || host === "127.0.0.1";

    if (process.env.NEXT_PUBLIC_API_URL) {
        const configured = process.env.NEXT_PUBLIC_API_URL;
        if (typeof window !== "undefined") {
            try {
                const parsed = new URL(configured);
                // If app is opened via LAN IP, avoid browser trying its own localhost.
                if (isLocalHost(parsed.hostname) && !isLocalHost(window.location.hostname)) {
                    parsed.hostname = window.location.hostname;
                }
                return stripTrailingSlash(parsed.toString());
            } catch {
                return stripTrailingSlash(configured);
            }
        }
        return stripTrailingSlash(configured);
    }

    // In browser, match the current host so localhost/127.0.0.1/LAN IP all work.
    if (typeof window !== "undefined") {
        return stripTrailingSlash(`${window.location.protocol}//${window.location.hostname}:8088/api`);
    }

    return "http://localhost:8088/api";
};

export const API_URL = resolveApiUrl();

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
    const url = `${API_URL}${endpoint}`;

    // Always include credentials to send/receive Flask session cookies
    const fetchOptions: RequestInit = {
        ...options,
        credentials: "include",
        headers: {
            "Accept": "application/json",
            ...options.headers,
        },
    };

    // If passing JSON body, automatically add the Content-Type header
    if (
        options.body &&
        typeof options.body === 'string' &&
        !("Content-Type" in (fetchOptions.headers || {}))
    ) {
        fetchOptions.headers = {
            ...fetchOptions.headers,
            "Content-Type": "application/json"
        };
    }

    const response = await fetch(url, fetchOptions);

    // Parse JSON response
    let data;
    try {
        data = await response.json();
    } catch (e) {
        data = null;
    }

    if (!response.ok) {
        throw new Error(data?.error || `HTTP Error ${response.status}`);
    }

    return data;
}
